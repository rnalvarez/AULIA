// AULIA — Teacher Studio API endpoint
//
// Set this to the deployed Google Apps Script Web App URL before publishing Studio.
// Example:
// export const STUDIO_API_ENDPOINT = "https://script.google.com/macros/s/XXXXXXXX/exec";

export const STUDIO_API_ENDPOINT = import.meta.env.VITE_AULIA_STUDIO_API || "";
