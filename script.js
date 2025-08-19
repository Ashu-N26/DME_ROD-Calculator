// --- CONSTANTS ---
const NM_TO_FT = 6076.118;

// --- GLOBAL VARIABLES ---
let descentProfileChart = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Pre-fill SDF inputs with example data from the image
    createSdfRow(5000, 12.0);
    createSdfRow(4000, 8.3);
    createSdfRow(3400, 6.1);
    createSdfRow(2360, 2.8);
    createSdfRow(); // Add an empty row for user input
});

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
        sdfs: []
    };

    document.querySelectorAll('.sdf-row').forEach(row => {
        const alt = parseFloat(row.querySelector('.sdf-alt').value);
        const dist = parseFloat(row.querySelector('.sdf-dist').value);
        if (!isNaN(alt) && !isNaN(dist)) {
            inputs.sdfs.push({ alt, dist });
        }
    });

    if (isNaN(inputs.thrElev) || isNaN(inputs.dmeAtThr) || isNaN(inputs.startAlt) || isNaN(inputs.mda)) {
        alert("Please fill all primary input fields.");
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

    // 3. CALCULATE FAF to MAPt distance and ideal points
    const faf = inputs.sdfs.reduce((prev, curr) => (prev.dist > curr.dist) ? prev : curr); // Find FAF (furthest DME)
    const fafGroundDistNM = faf.dist - inputs.dmeAtThr;
    
    // Missed Approach Point (MAPt) is typically at the runway threshold for CDFA
    const maptAlt = inputs.thrElev + 50; // Add 50ft Threshold Crossing Height (TCH)
    const maptHeight = maptAlt - inputs.thrElev;
    const maptGroundDistFt = maptHeight / slope;
    const maptGroundDistNM = maptGroundDistFt / NM_TO_FT;

    const fafToMaptDistNM = fafGroundDistNM - maptGroundDistNM;

    // 4. GENERATE 8-POINT DME TABLE (Navblue Style)
    // Find the highest and lowest DME points for our table range.
    const startTableDme = Math.floor(faf.dist);
    const endTableDme = Math.ceil(maptGroundDistNM + inputs.dmeAtThr) + 1; // Go a bit past threshold
    
    const idealDmePoints = [];
    // Calculate 8 evenly spaced ground distances between FAF and MAPt
    for (let i = 0; i <= 8; i++) {
        const fraction = i / 8;
        const currentGroundDistNm = fafGroundDistNM - (fafToMaptDistNM * fraction);
        const currentHeightFt = currentGroundDistNm * NM_TO_FT * slope;
        const currentAlt = inputs.thrElev + currentHeightFt;
        
        // CRITICAL: Calculate SLANT RANGE for the table
        const slantRangeNm = calculateSlantRange(currentGroundDistNm, currentHeightFt / NM_TO_FT);
        
        idealDmePoints.push({
            dist: slantRangeNm,
            alt: Math.round(currentAlt / 10) * 10 // Round to nearest 10 feet
        });
    }

    // 5. POPULATE UI TABLES
    document.getElementById('dme-id-header').innerText = inputs.rwId;
    document.getElementById('gp-angle').innerText = gpAngleDeg.toFixed(2) + '°';
    document.getElementById('gp-percent').innerText = gpPercent.toFixed(2) + '%';
    
    populateDmeTable(idealDmePoints, inputs.rwId);
    populateRodTable(gpAngleDeg, fafToMaptDistNM);
    
    // 6. RENDER VISUAL PROFILE CHART
    renderChart(inputs, idealDmePoints, gpAngleDeg);
}

function populateDmeTable(points, id) {
    const tbody = document.getElementById('dme-output-table').querySelector('tbody');
    tbody.innerHTML = '';
    points.forEach((point, index) => {
        // Ensure first point is bold like Navblue
        const isFaf = index === 0;
        const row = `
            <tr>
                <td>${point.dist.toFixed(1)}</td>
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
        // ROD (ft/min) = Groundspeed (NM/min) * Feet per NM * tan(GPA)
        const rod = (gs / 60) * NM_TO_FT * Math.tan(angleRad);
        document.getElementById(`rod-${gs}`).innerText = Math.round(rod / 10) * 10;

        // Time (min) = Distance (NM) / Groundspeed (NM/hr) * 60
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

// --- HELPER FUNCTIONS ---
function calculateSlantRange(ground
