// --- PDF PARSER SETUP ---
// Configure the pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js';

// Global variable to hold parsed data
let parsedChartData = {};

// Event Listener for the file upload
document.getElementById('pdf-upload').addEventListener('change', handleFileUpload);


// --- CONSTANTS ---
const NM_TO_FT = 6076.118;

// --- GLOBAL VARIABLES ---
let descentProfileChart = null;

// --- PDF PARSING LOGIC (NEW FEATURE) ---

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert('Please select a valid PDF file.');
        return;
    }

    const statusDiv = document.getElementById('parser-status');
    const resultsContainer = document.getElementById('parser-results-container');
    const populateBtn = document.getElementById('populate-btn');
    
    statusDiv.textContent = 'Processing PDF...';
    resultsContainer.style.display = 'none';
    populateBtn.style.display = 'none';
    
    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let allText = '';

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                allText += textContent.items.map(item => item.str).join(' ');
            }
            
            statusDiv.textContent = 'Extracting data from chart...';
            parseTextContent(allText);
        } catch (error) {
            statusDiv.textContent = 'Error processing PDF. It may be corrupted or protected.';
            console.error("PDF Processing Error:", error);
        }
    };
    fileReader.readAsArrayBuffer(file);
}

function parseTextContent(text) {
    // This is a "best-effort" parser using Regular Expressions (regex).
    // It is designed for common formats and may require adjustments for specific chart types.
    parsedChartData = {}; // Clear previous data

    // Parser for MDA/DA (looks for MDA, DA(H), or DA followed by a number)
    let mdaMatch = text.match(/(MDA|DA$H$|DA)\s*$H$\s*(\d{3,4})/i) || text.match(/(MDA|DA)\s+(\d{3,4})/i);
    if (mdaMatch) parsedChartData.mda = mdaMatch[2];

    // Parser for Glide Path Angle (looks for GS, G/S, or GP followed by a number like 3.00°)
    let gpMatch = text.match(/(GS|G\/S|GP)\s*(\d\.\d{2})°/i);
    if (gpMatch) parsedChartData.gpAngle = gpMatch[2];

    // Parser for FAF (Final Approach Fix) - This is complex and relies on common patterns.
    // Looks for a Maltese cross symbol (often not in text) or "FAF" label.
    // This regex looks for a 4-digit altitude, some text, a DME distance, and then "FAF".
    let fafMatch = text.match(/(\d{4})\s+[^a-zA-Z]*?(\d{1,2}\.\d)\s*FAF/i);
    if (fafMatch) {
        parsedChartData.fafAlt = fafMatch[1];
        parsedChartData.fafDist = fafMatch[2];
    }

    // Parser for Threshold Elevation
    let thrElevMatch = text.match(/(TDZE|Threshold Elev|ELEV)\s*(\d+)/i);
    if (thrElevMatch) parsedChartData.thrElev = thrElevMatch[2];
    
    displayParsedResults();
}

function displayParsedResults() {
    const resultsContainer = document.getElementById('parser-results-container');
    const statusDiv = document.getElementById('parser-status');
    const populateBtn = document.getElementById('populate-btn');
    
    resultsContainer.innerHTML = '<h4>Extracted Data (Please Verify!)</h4>'; // Reset
    
    let hasData = false;
    const createItem = (label, value) => {
        if (value) {
            hasData = true;
            resultsContainer.innerHTML += `<div class="parser-item"><span class="label">${label}:</span> <span class="value">${value}</span></div>`;
        }
    };
    
    createItem('Threshold Elev', parsedChartData.thrElev);
    
