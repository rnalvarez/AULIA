// AULIA — Google Apps Script backend template
// Asociar este script a una Google Sheet de la cátedra y desplegarlo como Web App.
// Script Properties esperadas:
// SHEET_ID, LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || '';
    switch (action) {
      case 'check': return json(checkStudent(body));
      case 'registrar': return json(registerPin(body));
      case 'verificar': return json(verifyPin(body));
      case 'log': return json(logInteraction(body));
      case 'chat': return json(chat(body));
      default: return json({ ok: false, error: 'Acción no reconocida.' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Falta la hoja ' + name);
  return sh;
}

function rows(name) {
  var values = sheet(name).getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(String);
  return values.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(header, i) { obj[header] = row[i]; });
    return obj;
  });
}

function checkStudent(body) {
  var dni = String(body.dni || '').replace(/\D/g, '');
  var matches = rows('PADRON').filter(function(row) { return String(row.DNI || '').replace(/\D/g, '') === dni; });
  if (!matches.length) return { found: false };
  var s = matches[0];
  return {
    found: true,
    activo: !(String(s.ACTIVO || '').toLowerCase() === 'no' || s.ACTIVO === false),
    nombre: s.NOMBRE || '',
    apellido: s.APELLIDO || '',
    comision: s.COMISION || '',
    hasPin: Boolean(s.PIN_HASH)
  };
}

function registerPin(body) {
  var dni = String(body.dni || '').replace(/\D/g, '');
  var pin = String(body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return { success: false, msg: 'PIN inválido.' };
  var sh = sheet('PADRON');
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var dniCol = headers.indexOf('DNI');
  var hashCol = headers.indexOf('PIN_HASH');
  if (dniCol < 0 || hashCol < 0) throw new Error('PADRON necesita DNI y PIN_HASH.');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dniCol]).replace(/\D/g, '') === dni) {
      sh.getRange(i + 1, hashCol + 1).setValue(hashPin(pin));
      return { success: true };
    }
  }
  return { success: false, msg: 'Alumno no encontrado.' };
}

function verifyPin(body) {
  var dni = String(body.dni || '').replace(/\D/g, '');
  var pin = String(body.pin || '');
  var sh = sheet('PADRON');
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var dniCol = headers.indexOf('DNI');
  var hashCol = headers.indexOf('PIN_HASH');
  if (dniCol < 0 || hashCol < 0) throw new Error('PADRON necesita DNI y PIN_HASH.');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dniCol]).replace(/\D/g, '') === dni) {
      return { allowed: values[i][hashCol] === hashPin(pin) };
    }
  }
  return { allowed: false };
}

function hashPin(pin) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin, Utilities.Charset.UTF_8);
  return digest.map(function(b) { var v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function logInteraction(body) {
  var sh = sheet('INTERACCIONES');
  sh.appendRow([
    new Date(),
    body.courseId || '',
    body.sid || '',
    body.dni || '',
    body.apellido || '',
    body.nombre || '',
    body.comision || '',
    body.modeId || '',
    body.activityId || '',
    body.model || '',
    body.q || '',
    body.r || '',
    Array.isArray(body.retrievedIds) ? body.retrievedIds.join('|') : String(body.retrievedIds || '')
  ]);
  return { ok: true };
}

function chat(body) {
  var props = PropertiesService.getScriptProperties();
  var endpoint = props.getProperty('LLM_ENDPOINT');
  var key = props.getProperty('LLM_API_KEY');
  var model = props.getProperty('LLM_MODEL');
  if (!endpoint || !key || !model) throw new Error('Faltan propiedades LLM_ENDPOINT, LLM_API_KEY o LLM_MODEL.');

  var system = buildSystemPrompt(body);
  var messages = [{ role: 'system', content: system }].concat(body.messages || []);
  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ model: model, messages: messages }),
    muteHttpExceptions: true
  });
  var text = response.getContentText();
  var data = JSON.parse(text || '{}');
  if (response.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'El proveedor LLM rechazó la solicitud.');
  var reply = data.reply || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return { reply: reply, model: data.model || model };
}

function buildSystemPrompt(body) {
  var assistant = body.assistant || {};
  var mode = body.mode || {};
  var retrieved = body.retrieved || [];
  var context = retrieved.map(function(item) { return item.title + ': ' + (item.explanation || item.summary || ''); }).join('\n\n');
  return [
    'Sos el asistente pedagógico de la cátedra.',
    'Asistente: ' + (assistant.name || ''),
    'Curso: ' + ((body.courseId) || ''),
    'Objetivo del modo: ' + (mode.pedagogicalGoal || ''),
    'Estrategia: ' + (mode.strategy || ''),
    'Instrucciones del asistente: ' + (assistant.instructions || ''),
    'Instrucciones del modo: ' + (mode.instructions || ''),
    'Trabajá únicamente con el corpus autorizado que se te proporciona.',
    'Unidades recuperadas:\n' + context
  ].join('\n\n');
}