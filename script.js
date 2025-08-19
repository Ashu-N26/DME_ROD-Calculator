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

    // 3. CALCULATE FAF to MAPt distance FOR GEOMETRY AND DME TABLE
    const faf = inputs.sdfs.reduce((prev, curr) => (prev.dist > curr.dist) ? prev : curr); // Find FAF (furthest DME)
    const fafGroundDistNM = faf.dist - inputs.dmeAtThr;
    
    const maptAlt = inputs.thrElev + 50; // Add 50ft Threshold Crossing Height (TCH)
    const maptHeight = maptAlt - inputs.thrElev;
    
