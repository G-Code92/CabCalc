// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCOQi_nbyVTCzGiTnw9qN5aR4m7QMeC9N8",
  authDomain: "cabcalc-6a319.firebaseapp.com",
  projectId: "cabcalc-6a319",
  storageBucket: "cabcalc-6a319.firebasestorage.app",
  messagingSenderId: "106060084837",
  appId: "1:106060084837:web:fca0f38fca938ee4dbb88c"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let appData = null;
let currentSlabs = [];
let currentSettings = {};

function getEl(id) { return document.getElementById(id); }
const $ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

function getDefaultSettings() {
    return {
        airportCut: 20.00,
        onlineCut: 6.00,
        normalCut: 2.50,
        fuelRate: 0.60
    };
}

function getDefaultSlabs() {
    return [
        { min: 0, max: 200, pct: 20 },
        { min: 201, max: 300, pct: 25 },
        { min: 301, max: 400, pct: 30 },
        { min: 401, max: 9999, pct: 35 }
    ];
}

// ─── FIRESTORE DATA HANDLING ───
function loadData() {
    if (!appData) {
        return { shifts: [], settings: getDefaultSettings(), slabs: getDefaultSlabs(), profile: { name: '', phone: '', email: '', picture: null } };
    }
    return appData;
}

function saveData(data) {
    appData = data;
    if (currentUser) {
        db.collection('users').doc(currentUser.uid).set(data)
          .catch(error => showToast('Cloud Sync Error: ' + error.message));
    }
}

// ─── SHIFT CALCULATION LOGIC ───
function calculateShift(revenue, totalTrips, airportTrips, onlineTrips, hiredKm, tolls, settings) {
    const normalTrips = Math.max(0, totalTrips - airportTrips - onlineTrips);
    const normalCut = settings.normalCut || 2.50;
    const airportCut = settings.airportCut || 20.00;
    const onlineCut = settings.onlineCut || 6.00;
    const fuelRate = settings.fuelRate || 0.60;

    const cutNormal = normalTrips * normalCut;
    const cutAirport = airportTrips * airportCut;
    const cutOnline = onlineTrips * onlineCut;
    const fuelCost = hiredKm * fuelRate;
    const tollsCost = tolls || 0;

    const totalCut = cutNormal + cutAirport + cutOnline;
    const cleanMoney = Math.max(0, revenue - totalCut - fuelCost - tollsCost);

    return { normalTrips, cutNormal, cutAirport, cutOnline, totalCut, fuelCost, tollsCost, cleanMoney };
}

function calculateCommission(shifts, settings, slabs) {
    if (!shifts || shifts.length === 0) return { totalCleanMoney: 0, dailyAverage: 0, matchedSlab: null, finalCommission: 0 };

    let totalCleanMoney = 0;
    let daysWorked = shifts.length;

    shifts.forEach(shift => {
        const calc = calculateShift(
            shift.revenue || 0, shift.totalTrips || 0, shift.airportTrips || 0,
            shift.onlineTrips || 0, shift.hiredKm || 0, shift.tolls || 0, settings
        );
        totalCleanMoney += calc.cleanMoney;
    });

    const dailyAverage = totalCleanMoney / daysWorked;
    const sortedSlabs = [...slabs].sort((a, b) => a.min - b.min);
    let matchedSlab = sortedSlabs[0] || { min: 0, max: 999999, pct: 0 };

    for (const slab of sortedSlabs) {
        if (dailyAverage >= slab.min && dailyAverage <= slab.max) {
            matchedSlab = slab;
            break;
        }
    }
    
    if (dailyAverage > sortedSlabs[sortedSlabs.length - 1].max) {
        matchedSlab = sortedSlabs[sortedSlabs.length - 1];
    }

    const finalCommission = totalCleanMoney * (matchedSlab.pct / 100);
    return { totalCleanMoney, dailyAverage, matchedSlab, finalCommission };
}

// ─── UI UPDATES ───
let toastTimer = null;
function showToast(msg, duration = 2500) {
    const toast = getEl('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showScreen(name) {
    const screens = ['login-screen', 'onboarding-rates', 'onboarding-slabs', 'main-app'];
    screens.forEach(id => {
        const el = getEl(id);
        if(el) {
            el.classList.remove('active');
            if (id === 'main-app') el.style.display = 'none';
        }
    });
    const target = getEl(name);
    if (target) {
        target.classList.add('active');
        if (name === 'main-app') {
            target.style.display = 'block';
            getEl('fabOpen').classList.remove('fab-hidden');
        } else {
            getEl('fabOpen').classList.add('fab-hidden');
        }
    }
}

function switchTab(tabId) {
    if (window.location.hash === '#' + tabId) {
        window.dispatchEvent(new Event('hashchange'));
    } else {
        window.location.hash = tabId;
    }
}

window.addEventListener('hashchange', function() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    const tabs = ['tab-dashboard', 'tab-rates', 'tab-slab', 'tab-profile'];
    tabs.forEach(id => {
        const el = getEl(id);
        if(el) el.classList.remove('active');
    });
    const target = getEl('tab-' + hash);
    if(target) target.classList.add('active');
    
    getEl('profileDropdown').classList.remove('open');
    if (hash === 'dashboard') {
        renderDashboard();
        getEl('headerBackBtn').style.display = 'none';
    } else {
        getEl('headerBackBtn').style.display = 'block';
    }
    if (hash === 'slab') renderSlabTab();
    if (hash === 'rates') loadRatesSettings();
});

getEl('headerBackBtn').addEventListener('click', () => window.history.back());

function renderDashboard() {
    const data = loadData();
    const shifts = data.shifts || [];
    const settings = data.settings || getDefaultSettings();
    const slabs = data.slabs || getDefaultSlabs();

    getEl('shiftCount').textContent = shifts.length + ' shift' + (shifts.length !== 1 ? 's' : '');

    const tbody = getEl('shiftTableBody');
    if (!shifts.length) {
        tbody.innerHTML = '';
        getEl('emptyShifts').style.display = 'block';
    } else {
        getEl('emptyShifts').style.display = 'none';
        const sorted = [...shifts].sort((a, b) => new Date(b.date) - new Date(a.date));
        tbody.innerHTML = sorted.map(shift => {
            const calc = calculateShift(
                shift.revenue || 0, shift.totalTrips || 0, shift.airportTrips || 0, 
                shift.onlineTrips || 0, shift.hiredKm || 0, shift.tolls || 0, settings
            );
            const date = shift.date ? new Date(shift.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
            const origIdx = data.shifts.indexOf(shift);
            return `<tr>
                <td>${date}</td>
                <td>${(shift.revenue || 0).toFixed(2)}</td>
                <td>${shift.totalTrips || 0}</td>
                <td>${shift.airportTrips || 0}</td>
                <td>${shift.onlineTrips || 0}</td>
                <td>${calc.totalCut.toFixed(2)}</td>
                <td>${calc.fuelCost.toFixed(2)}</td>
                <td>${(shift.tolls || 0).toFixed(2)}</td>
                <td><strong>${calc.cleanMoney.toFixed(2)}</strong></td>
                <td style="text-align:center;">
                    <button class="action-btn" onclick="openShiftModal(${origIdx})">✎</button>
                    <button class="action-btn delete-btn" onclick="deleteShift(${origIdx})">✕</button>
                </td>
            </tr>`;
        }).join('');
    }
    updateStats();
}

window.deleteShift = function(idx) {
    if (confirm('Delete this shift?')) {
        const data = loadData();
        data.shifts.splice(idx, 1);
        saveData(data);
        renderDashboard();
        showToast('Shift deleted');
    }
};

function updateStats() {
    const data = loadData();
    const commData = calculateCommission(data.shifts, data.settings, data.slabs);
    getEl('sumTotalRevenue').textContent = commData.totalCleanMoney.toFixed(2) + ' AED';
    getEl('sumNet').textContent = commData.finalCommission.toFixed(2) + ' AED';

    if (commData.matchedSlab) {
        getEl('dashboardCommissionPct').innerHTML = commData.matchedSlab.pct + '% <span class="sub">on ' + commData.dailyAverage.toFixed(0) + ' Avg</span>';
    } else {
        getEl('dashboardCommissionPct').innerHTML = '— <span class="sub">no slab</span>';
    }
}

// ─── SHIFT MODAL ───
window.openShiftModal = function(editIndex) {
    const data = loadData();
    if (editIndex !== undefined && editIndex >= 0 && editIndex < data.shifts.length) {
        const shift = data.shifts[editIndex];
        getEl('shiftDate').value = shift.date || '';
        getEl('shiftRevenue').value = shift.revenue || '';
        getEl('shiftTotalTrips').value = shift.totalTrips || '';
        getEl('shiftAirport').value = shift.airportTrips || 0;
        getEl('shiftOnline').value = shift.onlineTrips || 0;
        getEl('shiftHiredKm').value = shift.hiredKm || 0;
        getEl('shiftTolls').value = shift.tolls || 0;
        getEl('shiftEditIndex').value = editIndex;
    } else {
        getEl('shiftDate').value = new Date().toISOString().split('T')[0];
        getEl('shiftRevenue').value = '';
        getEl('shiftTotalTrips').value = '';
        getEl('shiftAirport').value = 0;
        getEl('shiftOnline').value = 0;
        getEl('shiftHiredKm').value = 0;
        getEl('shiftTolls').value = 0;
        getEl('shiftEditIndex').value = -1;
    }
    updateShiftPreview();
    getEl('shiftModal').classList.add('open');
};

getEl('modalClose').addEventListener('click', () => getEl('shiftModal').classList.remove('open'));
getEl('fabOpen').addEventListener('click', () => openShiftModal(-1));
getEl('shiftCancelBtn').addEventListener('click', () => getEl('shiftModal').classList.remove('open'));

function updateShiftPreview() {
    const data = loadData();
    const settings = data.settings || getDefaultSettings();
    const revenue = Number(getEl('shiftRevenue').value) || 0;
    const totalTrips = Number(getEl('shiftTotalTrips').value) || 0;
    const airportTrips = Number(getEl('shiftAirport').value) || 0;
    const onlineTrips = Number(getEl('shiftOnline').value) || 0;
    const hiredKm = Number(getEl('shiftHiredKm').value) || 0;
    const tolls = Number(getEl('shiftTolls').value) || 0;

    const calc = calculateShift(revenue, totalTrips, airportTrips, onlineTrips, hiredKm, tolls, settings);

    getEl('previewNormal').textContent = calc.normalTrips;
    getEl('previewCompanyCut').textContent = calc.totalCut.toFixed(2) + ' AED';
    getEl('previewFuel').textContent = calc.fuelCost.toFixed(2) + ' AED';
    getEl('previewTolls').textContent = calc.tollsCost.toFixed(2) + ' AED';
    getEl('previewNet').textContent = calc.cleanMoney.toFixed(2) + ' AED';
}

['shiftRevenue', 'shiftTotalTrips', 'shiftAirport', 'shiftOnline', 'shiftHiredKm', 'shiftTolls'].forEach(id => {
    getEl(id).addEventListener('input', updateShiftPreview);
});

getEl('shiftForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const date = getEl('shiftDate').value;
    const revenue = Number(getEl('shiftRevenue').value) || 0;
    const totalTrips = Number(getEl('shiftTotalTrips').value) || 0;
    const airportTrips = Number(getEl('shiftAirport').value) || 0;
    const onlineTrips = Number(getEl('shiftOnline').value) || 0;
    const hiredKm = Number(getEl('shiftHiredKm').value) || 0;
    const tolls = Number(getEl('shiftTolls').value) || 0;

    if (!date || revenue <= 0 || totalTrips <= 0) {
        showToast('Valid date, revenue, and trips required.'); return;
    }

    const data = loadData();
    const idx = parseInt(getEl('shiftEditIndex').value, 10);
    const shiftData = { date, revenue, totalTrips, airportTrips, onlineTrips, hiredKm, tolls };

    if (idx >= 0 && idx < data.shifts.length) data.shifts[idx] = shiftData;
    else data.shifts.push(shiftData);

    saveData(data);
    getEl('shiftModal').classList.remove('open');
    renderDashboard();
    showToast('Shift saved');
});

// ─── RATES TAB ───
function loadRatesSettings() {
    const data = loadData();
    getEl('settingNormalCut').value = data.settings.normalCut || 2.50;
    getEl('settingOnlineCut').value = data.settings.onlineCut || 6.00;
    getEl('settingAirportCut').value = data.settings.airportCut || 20.00;
    getEl('settingFuelRate').value = data.settings.fuelRate || 0.60;
}

getEl('saveSettingsBtn').addEventListener('click', () => {
    const data = loadData();
    data.settings.normalCut = Number(getEl('settingNormalCut').value) || 0;
    data.settings.onlineCut = Number(getEl('settingOnlineCut').value) || 0;
    data.settings.airportCut = Number(getEl('settingAirportCut').value) || 0;
    data.settings.fuelRate = Number(getEl('settingFuelRate').value) || 0;
    saveData(data);
    showToast('Rates saved');
    renderDashboard();
});

// ─── SLAB TAB ───
function renderSlabTab() {
    const data = loadData();
    currentSlabs = data.slabs || getDefaultSlabs();
    
    const tbody = getEl('slabTableBody');
    tbody.innerHTML = currentSlabs.map((s, i) => `
        <tr>
            <td><input type="number" class="slab-min" value="${s.min}" data-idx="${i}"></td>
            <td><input type="number" class="slab-max" value="${s.max}" data-idx="${i}"></td>
            <td><input type="number" class="slab-pct" value="${s.pct}" data-idx="${i}"></td>
            <td><button class="delete-slab text-red-600" data-idx="${i}">✕</button></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.delete-slab').forEach(btn => btn.addEventListener('click', function() {
        if(currentSlabs.length > 1) {
            currentSlabs.splice(this.dataset.idx, 1);
            getEl('saveSlabsBtn').click();
        } else { showToast('Need at least one slab'); }
    }));

    updateCycleDisplay();
}

function updateCycleDisplay() {
    const data = loadData();
    const commData = calculateCommission(data.shifts, data.settings, currentSlabs);
    getEl('monthlyRevenue').textContent = commData.totalCleanMoney.toFixed(2) + ' AED';
    getEl('slabDailyAverage').textContent = commData.dailyAverage.toFixed(2) + ' AED';
    
    if (commData.matchedSlab) {
        getEl('matchedSlabDesc').textContent = commData.matchedSlab.min + ' – ' + commData.matchedSlab.max + ' AED';
        getEl('slabCommissionPct').textContent = commData.matchedSlab.pct + '%';
        getEl('slabNetIncome').textContent = commData.finalCommission.toFixed(2) + ' AED';
    }
}

getEl('addSlabRowBtn').addEventListener('click', () => {
    const last = currentSlabs[currentSlabs.length - 1];
    currentSlabs.push({ min: last ? last.max + 1 : 0, max: last ? last.max + 100 : 300, pct: 20 });
    renderSlabTab();
});

getEl('saveSlabsBtn').addEventListener('click', () => {
    const rows = getEl('slabTableBody').querySelectorAll('tr');
    const newSlabs = [];
    rows.forEach(r => {
        const min = Number(r.querySelector('.slab-min').value)||0;
        const max = Number(r.querySelector('.slab-max').value)||0;
        const pct = Number(r.querySelector('.slab-pct').value)||0;
        newSlabs.push({min, max, pct});
    });
    const data = loadData();
    data.slabs = newSlabs.sort((a, b) => a.min - b.min);
    saveData(data);
    showToast('Slabs saved');
    renderSlabTab();
    renderDashboard();
});

// ─── PROFILE DROPDOWN & MENUS LOGIC ───
const profileBtn = getEl('profileBtn');
const profileDropdown = getEl('profileDropdown');

profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
        profileDropdown.classList.remove('open');
    }
});

document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
    item.addEventListener('click', function() {
        const action = this.dataset.action;
        profileDropdown.classList.remove('open');

        if (action === 'dashboard') switchTab('dashboard');
        if (action === 'target') switchTab('slab');
        if (action === 'cutting') switchTab('rates');
        
        if (action === 'terms') getEl('termsModal').classList.add('open');
        if (action === 'feedback') getEl('feedbackModal').classList.add('open');
        
        if (action === 'logout') {
            auth.signOut().then(() => {
                appData = null;
                currentUser = null;
                showScreen('login-screen');
                showToast('Logged out');
            });
        }
    });
});

getEl('termsModalClose').addEventListener('click', () => getEl('termsModal').classList.remove('open'));
getEl('termsAcceptBtn').addEventListener('click', () => getEl('termsModal').classList.remove('open'));
getEl('feedbackModalClose').addEventListener('click', () => getEl('feedbackModal').classList.remove('open'));

// ─── LOGIN & AUTHENTICATION LOGIC ───
document.querySelectorAll('.login-tabs button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.login-tabs button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const tab = e.target.dataset.tab;
        if (tab === 'login') {
            getEl('loginForm').style.display = 'block';
            getEl('signupForm').style.display = 'none';
        } else {
            getEl('loginForm').style.display = 'none';
            getEl('signupForm').style.display = 'block';
        }
    });
});

getEl('signupSubmitBtn').addEventListener('click', () => {
    const email = getEl('signupEmail').value;
    const pass = getEl('signupPassword').value;
    
    if (!email || pass.length < 6) {
        showToast('Enter a valid email and 6+ chars password');
        return;
    }
    
    auth.createUserWithEmailAndPassword(email, pass)
        .catch((error) => showToast(error.message));
});

getEl('loginSubmitBtn').addEventListener('click', () => {
    const email = getEl('loginEmail').value;
    const pass = getEl('loginPassword').value;
    
    if (!email || !pass) {
        showToast('Enter email and password');
        return;
    }
    
    auth.signInWithEmailAndPassword(email, pass)
        .catch((error) => showToast(error.message));
});

// ─── AUTH STATE OBSERVER (BOOT) ───
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        db.collection('users').doc(user.uid).get().then((doc) => {
            if (doc.exists) {
                appData = doc.data();
                if (!appData.shifts) appData.shifts = [];
                if (!appData.settings) appData.settings = getDefaultSettings();
                if (!appData.slabs) appData.slabs = getDefaultSlabs();
            } else {
                appData = { shifts: [], settings: getDefaultSettings(), slabs: getDefaultSlabs() };
            }
            showScreen('main-app');
            switchTab('dashboard');
        }).catch(error => {
            showToast("Error loading data: " + error.message);
        });
    } else {
        currentUser = null;
        appData = null;
        showScreen('login-screen');
    }
});


