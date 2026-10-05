// AULIA — Teacher Studio API endpoint
//
// Set this to the deployed Google Apps Script Web App URL before publishing Studio.
// Example:
// export const STUDIO_API_ENDPOINT = "https://script.google.com/macros/s/XXXXXXXX/exec";

export const STUDIO_API_ENDPOINT = import.meta.env.VITE_AULIA_STUDIO_API || "https://script.google.com/macros/s/AKfycbyAwNsWF0Vj-aO68aD8RAot6K7RBp0J5xWA4GKsbpFQOrEPzFaIfrC-s342bO27Hn1e/exec";
