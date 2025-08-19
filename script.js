// --- CONSTANTS ---
const NM_TO_FT = 6076.118;

// --- GLOBAL VARIABLES ---
let descentProfileChart = null;
let parsedChartData = {}; // For PDF Parser

// --- CORE APPLICATION LOGIC ---
// This section is now at the top to ensure functions are defined before they are called.

function addSdfRow() {
    createSdfRow();
}

function createSdfRow(alt = '', dist = '') {
    const container = document.getElementById('sdf-inputs');
    const row = document.createElement('div');
    row.classList.add('sdf-row');
    row.innerHTML = `
        <input type="number" class="sdf-alt" placeholder="Altitude" value="${alt}">
        <input type="number" step="0.1" class="sdf-dist" placeholder="DME Dist" value="${dist}">
        <button onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(row);
}

function calculateAll() {
    // 1. GATHER INPUTS
    const inputs = {
        thrElev: parseFloat(document.getElementById('thr-elev').value),
        dmeAtThr: parseFloat(document.getElementById('dme-at-thr').value),
        startAlt: parseFloat(document.getElementById('start-alt').value),
        mda: parseFloat(document.getElementById('mda').value),
        rwId: document.getElementById('rw-id').value,
        fafMaptDist: parseFloat(document.getElementById('faf-mapt-dist').value),
        sdfs: []
    };

    document.querySelectorAll('.sdf-row').forEach(row => {
        const alt = parseFloat(row.querySelector('.sdf-alt').value);
        const dist = parseFloat(row.querySelector('.sdf-dist').value);
        if (!isNaN(alt) && !isNaN(dist)) {
            inputs.sdfs.push({ alt, dist });
        }
    });

    if (isNaN(inputs.thrElev) || isNaN(inputs.dmeAtThr) || isNaN(inputs.startAlt) || isNaN(inputs.mda) || isNaN(inputs.fafMaptDist)) {
        alert("Please fill all primary input fields, including FAF-MAPt distance.");
        return;
    }
    if (inputs.sdfs.length < 2) {
        alert("Please provide at least two valid Step-Down Fixes to calculate a glide path.");
        return;
    }

    // 2. CALCULATE GLIDE PATH ANGLE (GPA) using linear regression for best fit
    let n = 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    inputs.sdfs.forEach(fix => {
        const groundDistFt = (fix.dist - inputs.dmeAtThr) * NM_TO_FT;
        const heightFt = fix.alt - inputs.thrElev;
        if (groundDistFt > 0 && heightFt > 0) {
            n++;
            sumX += groundDistFt;
            sumY += heightFt;
            sumXY += groundDistFt * heightFt;
            sumX2 += groundDistFt * groundDistFt;
        }
    });
    
    if (n < 2) {
        alert("Not enough valid SDF data points above threshold to calculate a reliable path.");
        return;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const gpAngleRad = Math.atan(slope);
    const gpAngleDeg = gpAngleRad * (180 / Math.PI);
    const gpPercent = slope * 100;

    // 3. FIND FAF
    const faf = inputs.sdfs.reduce((prev, curr) => (prev.dist > curr.dist) ? prev : curr);

    // 4. GENERATE 8-POINT DME TABLE (Corrected Logic)
    const idealDmePoints = [];
    idealDmePoints.push({
        dist: faf.dist,
        alt: Math.round(faf.alt / 10) * 10
    });
    let currentDme = Math.floor(faf.dist);
    while (idealDmePoints.length < 8) {
        const groundDistFromDmeStationNM = currentDme / Math.sqrt(1 + slope * slope);
        const groundDistFromThrFt = (groundDistFromDmeStationNM - inputs.dmeAtThr) * NM_TO_FT;
        if (groundDistFromThrFt < 0) break;
        const idealHeightFt = groundDistFromThrFt * slope;
        const idealAltitude = inputs.thrElev + idealHeightFt;
        if (idealAltitude < inputs.mda) break;
        idealDmePoints.push({
            dist: currentDme,
            alt: Math.round(idealAltitude / 10) * 10
        });
        currentDme -= 1;
    }

    // 5. POPULATE UI
    document.getElementById('dme-id-header').innerText = inputs.rwId;
    document.getElementById('gp-angle').innerText = gpAngleDeg.toFixed(2) + '°';
    document.getElementById('gp-percent').innerText = gpPercent.toFixed(2) + '%';
    
    populateDmeTable(idealDmePoints);
    populateRodTable(gpAngleDeg, inputs.fafMaptDist, slope); // Pass slope for ft/NM calculation
    
    renderChart(inputs, idealDmePoints, gpAngleDeg);
    
    document.getElementById('export-csv-btn').disabled = false;
    document.getElementById('export-pdf-btn').disabled = false;
}

function populateDmeTable(points) {
    const tbody = document.getElementById('dme-output-table').querySelector('tbody');
    tbody.innerHTML = '';
    points.forEach((point, index) => {
        const isFaf = index === 0;
        tbody.innerHTML += `
            <tr>
                <td>${Number(point.dist).toFixed(1)}</td>
                <td>${isFaf ? `<strong>${point.alt}</strong>` : point.alt}</td>
            </tr>`;
    });
}

function populateRodTable(angleDeg, distanceNM, slope) {
    const groundSpeeds = [80, 100, 120, 140, 160];
    const angleRad = angleDeg * (Math.PI / 180);

    // NEW: Calculate and display ft/NM
    const ftPerNm = slope * NM_TO_FT;
    document.getElementById('ft-nm-80').innerText = Math.round(ftPerNm);
    
    groundSpeeds.forEach(gs => {
        const rod = (gs / 60) * NM_TO_FT * Math.tan(angleRad);
        document.getElementById(`rod-${gs}`).innerText = Math.round(rod / 10) * 10;
        const timeMinutes = (distanceNM / gs) * 60;
        document.getElementById(`time-${gs}`).innerText = toMMSS(timeMinutes);
    });
}

function renderChart(inputs, idealPath, gpAngle) {
    const ctx = document.getElementById('descentProfileChart').getContext('2d');
    const chartData = {
        datasets: [
            {
                label: `Ideal Descent Path (${gpAngle.toFixed(2)}°)`,
                data: idealPath.map(p => ({ x: p.dist, y: p.alt })),
                borderColor: 'rgba(77, 166, 255, 1)',
                backgroundColor: 'rgba(77, 166, 255, 0.5)',
                type: 'line', fill: false, pointRadius: 4, pointBackgroundColor: 'rgba(77, 166, 255, 1)',
            },
            {
                label: 'Step-Down Fixes (SDF)',
                data: inputs.sdfs.map(p => ({ x: p.dist, y: p.alt })),
                borderColor: 'rgba(255, 204, 0, 1)', backgroundColor: 'rgba(255, 204, 0, 1)',
                type: 'scatter', pointRadius: 6, pointStyle: 'triangle',
            },
            {
                label: 'MDA',
                data: [{x: 20, y: inputs.mda}, {x: 0, y: inputs.mda}],
                borderColor: 'rgba(255, 77, 77, 0.8)', borderDash: [5, 5],
                type: 'line', fill: false, pointRadius: 0,
            },
            {
                label: 'Threshold',
                data: [{x: inputs.dmeAtThr, y: inputs.thrElev}],
                backgroundColor: 'rgba(0, 200, 83, 1)', type: 'scatter',
                pointRadius: 8, pointStyle: 'rect',
            }
        ]
    };
    if (descentProfileChart) descentProfileChart.destroy();
    descentProfileChart = new Chart(ctx, {
        type: 'line', data: chartData,
        options: {
            scales: {
                x: {
                    type: 'linear', position: 'bottom', reverse: true,
                    title: { display: true, text: 'DME Distance (NM)', color: '#e0e0e0' },
                    grid: { color: '#444' }, ticks: { color: '#e0e0e0' }
                },
                y: {
                    title: { display: true, text: 'Altitude (ft)', color: '#e0e0e0' },
                    grid: { color: '#444' }, ticks: { color: '#e0e0e0' }
                }
            },
            plugins: {
                legend: { labels: { color: '#e0e0e0' } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: (${ctx.parsed.x.toFixed(1)} NM, ${Math.round(ctx.parsed.y)} ft)` } }
            },
            responsive: true, maintainAspectRatio: false,
        }
    });
}

function toMMSS(minutes) {
    const mm = Math.floor(minutes);
    const ss = Math.round((minutes - mm) * 60);
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}


// --- PDF PARSER LOGIC ---
// This section is now at the bottom, after the core functions are defined.

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js';
document.getElementById('pdf-upload').addEventListener('change', handleFileUpload);

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
    parsedChartData = {};
    let mdaMatch = text.match(/(MDA|DA$H$|DA)\s*$H$\s*(\d{3,4})/i) || text.match(/(MDA|DA)\s+(\d{3,4})/i);
    if (mdaMatch) parsedChartData.mda = mdaMatch[2];
    let gpMatch = text.match(/(GS|G\/S|GP)\s*(\d\.\d{2})°/i);
    if (gpMatch) parsedChartData.gpAngle = gpMatch[2];
    let fafMatch = text.match(/(\d{4})\s+[^a-zA-Z]*?(\d{1,2}\.\d)\s*FAF/i);
    if (fafMatch) {
        parsedChartData.fafAlt = fafMatch[1];
        parsedChartData.fafDist = fafMatch[2];
    }
    let thrElevMatch = text.match(/(TDZE|Threshold Elev|ELEV)\s*(\d+)/i);
    if (thrElevMatch) parsedChartData.thrElev = thrElevMatch[2];
    displayParsedResults();
}

function displayParsedResults() {
    const resultsContainer = document.getElementById('parser-results-container');
    const statusDiv = document.getElementById('parser-status');
    const populateBtn = document.getElementById('populate-btn');
    resultsContainer.innerHTML = '<h4>Extracted Data (Please Verify!)</h4>';
    let hasData = false;
    const createItem = (label, value) => {
        if (value) {
            hasData = true;
            resultsContainer.innerHTML += `<div class="parser-item"><span class="label">${label}:</span> <span class="value">${value}</span></div>`;
        }
    };
    createItem('Threshold Elev', parsedChartData.thrElev);
    createItem('MDA', parsedChartData.mda);
    createItem('GP Angle', parsedChartData.gpAngle ? parsedChartData.gpAngle + '°' : null);

    if (parsedChartData.fafAlt && parsedChartData.fafDist) {
        createItem('FAF', `${parsedChartData.fafAlt} ft @ ${parsedChartData.fafDist} NM`);
    }

    if(hasData) {
        statusDiv.textContent = 'Extraction complete. Please verify the data below.';
        resultsContainer.style.display = 'block';
        populateBtn.style.display = 'block';
    } else {
        statusDiv.textContent = 'Could not automatically extract data. Please use manual entry.';
    }
}

function populateInputsFromParser() {
    if (parsedChartData.mda) document.getElementById('mda').value = parsedChartData.mda;
    if (parsedChartData.fafAlt) document.getElementById('start-alt').value = parsedChartData.fafAlt;
    if (parsedChartData.thrElev) document.getElementById('thr-elev').value = parsedChartData.thrElev;
    document.getElementById('sdf-inputs').innerHTML = '';
    if (parsedChartData.fafAlt && parsedChartData.fafDist) {
        createSdfRow(parsedChartData.fafAlt, parsedChartData.fafDist);
    }
    alert('Input fields have been populated. Please review all values, add any other required step-down fixes, and then calculate.');
}

// --- EXPORT FUNCTIONS ---
function getTableDataForExport() {
    const rwId = document.getElementById('rw-id').value;
    const gpAngle = document.getElementById('gp-angle').innerText;
    const dmeHeaders = ['DIST (NM)', 'ALT (ft)'];
    const dmeRows = Array.from(document.getElementById('dme-output-table').querySelectorAll('tbody tr')).map(tr => [tr.cells[0].innerText, tr.cells[1].innerText]);
    const rodHeaders = ['Profile', 'GS 80', 'GS 100', 'GS 120', 'GS 140', 'GS 160'];
    const rodRows = Array.from(document.getElementById('rod-output-table').querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText));
    return { rwId, gpAngle, dmeHeaders, dmeRows, rodHeaders, rodRows };
}

function exportToCsv() {
    const { rwId, dmeHeaders, dmeRows, rodHeaders, rodRows } = getTableDataForExport();
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += `DME Table for ${rwId}\r\n`;
    csvContent += dmeHeaders.join(",") + "\r\n";
    dmeRows.forEach(rowArray => csvContent += rowArray.join(",") + "\r\n");
    csvContent += "\r\nRate of Descent Table\r\n";
    csvContent += rodHeaders.join(",") + "\r\n";
    rodRows.forEach(rowArray => csvContent += rowArray.join(",") + "\r\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
