// --- CONSTANTS ---
const NM_TO_FT = 6076.118;

// --- GLOBAL VARIABLES ---
let descentProfileChart = null;

// --- INITIALIZATION ---
// NOTE: DOMContentLoaded listener removed. Page will start blank and user adds all SDFs.

// --- UI MANAGEMENT FUNCTIONS ---
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

function addSdfRow() {
    createSdfRow();
}

// --- CORE CALCULATION FUNCTION ---
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

    // 4. GENERATE 8-POINT DME TABLE (NEW LOGIC)
    const idealDmePoints = [];
    
    // The first point is always the FAF itself.
    idealDmePoints.push({
        dist: faf.dist,
        alt: Math.round(faf.alt / 10) * 10
    });

    // Start from the next whole DME distance down from the FAF.
    let currentDme = Math.floor(faf.dist);

    while (idealDmePoints.length < 8) {
        // We have the slant distance (currentDme). We need to find the altitude.
        // This requires solving for ground distance first.
        // Slant² = Ground² + Height²  AND Height = Ground * slope
        // Slant² = Ground² * (1 + slope²)
        // Ground = Slant / sqrt(1 + slope²)
        
        const groundDistFromDmeStationNM = currentDme / Math.sqrt(1 + slope * slope);
        const groundDistFromThrFt = (groundDistFromDmeStationNM - inputs.dmeAtThr) * NM_TO_FT;

        if (groundDistFromThrFt < 0) break; // Stop if we are past the threshold

        const idealHeightFt = groundDistFromThrFt * slope;
        const idealAltitude = inputs.thrElev + idealHeightFt;
        
        // Stop if the next point would be below MDA.
        if (idealAltitude < inputs.mda) {
            break; 
        }

        idealDmePoints.push({
            dist: currentDme,
            alt: Math.round(idealAltitude / 10) * 10 // Round to nearest 10 feet
        });
        
        currentDme -= 1; // Decrement to the next whole mile
    }

    // 5. POPULATE UI
    document.getElementById('dme-id-header').innerText = inputs.rwId;
    document.getElementById('gp-angle').innerText = gpAngleDeg.toFixed(2) + '°';
    document.getElementById('gp-percent').innerText = gpPercent.toFixed(2) + '%';
    
    populateDmeTable(idealDmePoints);
    populateRodTable(gpAngleDeg, inputs.fafMaptDist);
    
    // 6. RENDER VISUAL PROFILE CHART
    renderChart(inputs, idealDmePoints, gpAngleDeg);
    
    // 7. ENABLE EXPORT BUTTONS
    document.getElementById('export-csv-btn').disabled = false;
    document.getElementById('export-pdf-btn').disabled = false;
}

function populateDmeTable(points) {
    const tbody = document.getElementById('dme-output-table').querySelector('tbody');
    tbody.innerHTML = '';
    points.forEach((point, index) => {
        const isFaf = index === 0;
        const row = `
            <tr>
                <td>${Number(point.dist).toFixed(1)}</td>
                <td>${isFaf ? `<strong>${point.alt}</strong>` : point.alt}</td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function populateRodTable(angleDeg, distanceNM) {
    const groundSpeeds = [80, 100, 120, 140, 160];
    const angleRad = angleDeg * (Math.PI / 180);

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
                type: 'line',
                fill: false,
                pointRadius: 4,
                pointBackgroundColor: 'rgba(77, 166, 255, 1)',
            },
            {
                label: 'Step-Down Fixes (SDF)',
                data: inputs.sdfs.map(p => ({ x: p.dist, y: p.alt })),
                borderColor: 'rgba(255, 204, 0, 1)',
                backgroundColor: 'rgba(255, 204, 0, 1)',
                type: 'scatter',
                pointRadius: 6,
                pointStyle: 'triangle',
            },
            {
                label: 'MDA',
                data: [{x: 20, y: inputs.mda}, {x: 0, y: inputs.mda}],
                borderColor: 'rgba(255, 77, 77, 0.8)',
                borderDash: [5, 5],
                type: 'line',
                fill: false,
                pointRadius: 0,
            },
            {
                label: 'Threshold',
                data: [{x: inputs.dmeAtThr, y: inputs.thrElev}],
                backgroundColor: 'rgba(0, 200, 83, 1)',
                type: 'scatter',
                pointRadius: 8,
                pointStyle: 'rect',
            }
        ]
    };

    if (descentProfileChart) {
        descentProfileChart.destroy();
    }

    descentProfileChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    reverse: true,
                    title: {
                        display: true,
                        text: 'DME Distance (NM)',
                        color: '#e0e0e0'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#e0e0e0' }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Altitude (ft)',
                        color: '#e0e0e0'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#e0e0e0' }
                }
            },
            plugins: {
                legend: { labels: { color: '#e0e0e0' } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: (${context.parsed.x.toFixed(1)} NM, ${Math.round(context.parsed.y)} ft)`;
                        }
                    }
                }
            },
            responsive: true,
            maintainAspectRatio: false,
        }
    });
}

// --- HELPER & EXPORT FUNCTIONS ---
function calculateSlantRange(groundDistNM, heightNM) {
    return Math.sqrt(Math.pow(groundDistNM, 2) + Math.pow(heightNM, 2));
}

function toMMSS(minutes) {
    const mm = Math.floor(minutes);
    const ss = Math.round((minutes - mm) * 60);
    return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

function getTableDataForExport() {
    const rwId = document.getElementById('rw-id').value;
    const gpAngle = document.getElementById('gp-angle').innerText;

    const dmeHeaders = ['DIST (NM)', 'ALT (ft)'];
    const dmeRows = Array.from(document.getElementById('dme-output-table').querySelectorAll('tbody tr')).map(tr => {
        const cells = tr.querySelectorAll('td');
        return [cells[0].innerText, cells[1].innerText];
    });

    const rodHeaders = ['GS (kts)', '80', '100', '120', '140', '160'];
    const rodRows = Array.from(document.getElementById('rod-output-table').querySelectorAll('tbody tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td')).map(td => td.
