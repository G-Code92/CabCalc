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
        fuelRate: 0.60,
        cycleStartDay: 1
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

// ─── CYCLE FILTER LOGIC ───
function getCurrentCycleShifts(shifts, startDay) {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let day = now.getDate();

    if (day < startDay) {
        month -= 1;
        if (month < 0) { month = 11; year -= 1; }
    }
    const cycleStart = new Date(year, month, startDay);
    
    return shifts.filter(s => {
        if (!s.date) return false;
        const shiftDate = new Date(s.date);
        shiftDate.setHours(0,0,0,0);
        return shiftDate >= cycleStart;
    });
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
    const tabs = ['tab-dashboard', 'tab-rates', 'tab-slab', 'tab-profile', 'tab-history'];
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
    if (hash === 'profile') loadProfileSettings();
    if (hash === 'history') renderHistoryTab();
});

getEl('headerBackBtn').addEventListener('click', () => window.history.back());

function renderDashboard() {
    const data = loadData();
    const settings = data.settings || getDefaultSettings();
    const slabs = data.slabs || getDefaultSlabs();
    const allShifts = data.shifts || [];
    
    const currentShifts = getCurrentCycleShifts(allShifts, settings.cycleStartDay || 1);

    getEl('shiftCount').textContent = currentShifts.length + ' shift' + (currentShifts.length !== 1 ? 's' : '');

    const tbody = getEl('shiftTableBody');
    if (!currentShifts.length) {
        tbody.innerHTML = '';
        getEl('emptyShifts').style.display = 'block';
    } else {
        getEl('emptyShifts').style.display = 'none';
        const sorted = [...currentShifts].sort((a, b) => new Date(b.date) - new Date(a.date));
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
    const currentShifts = getCurrentCycleShifts(data.shifts || [], data.settings.cycleStartDay || 1);
    const commData = calculateCommission(currentShifts, data.settings, data.slabs);
    
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
    getEl('settingCycleStart').value = data.settings.cycleStartDay || 1;
    
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
    const currentShifts = getCurrentCycleShifts(data.shifts || [], data.settings.cycleStartDay || 1);
    const commData = calculateCommission(currentShifts, data.settings, currentSlabs);
    
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

getEl('saveCycleBtn').addEventListener('click', () => {
    const data = loadData();
    let start = Number(getEl('settingCycleStart').value) || 1;
    if(start < 1) start = 1;
    if(start > 28) start = 28;
    data.settings.cycleStartDay = start;
    saveData(data);
    showToast('Cycle Start Date saved');
    updateCycleDisplay();
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
        if (action === 'settings') switchTab('profile');
        if (action === 'history') switchTab('history');
        
        if (action === 'invite') {
            if (navigator.share) {
                navigator.share({
                    title: 'CabCalc',
                    text: 'Try CabCalc to easily calculate your driving shifts and net income!',
                    url: window.location.href
                }).catch(err => console.log('Share error:', err));
            } else {
                showToast('Sharing not supported on this browser. Copy the URL manually.');
            }
        }
        
        if (action === 'export-backup') {
            const data = loadData();
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", "CabCalc_Backup.json");
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToast('Backup exported successfully!');
        }
        
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
            updateHeaderAvatar();
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

// ─── FORGOT PASSWORD LOGIC ───
getEl('forgotPwLink').addEventListener('click', () => {
    const email = getEl('loginEmail').value;
    
    if (!email) {
        showToast('Error: Enter your email address in the box first.');
        return;
    }
    
    auth.sendPasswordResetEmail(email)
        .then(() => {
            showToast('Success: Password reset link sent to your email.');
        })
        .catch((error) => {
            showToast('Error: ' + error.message);
        });
});

// ─── AUTO-FILL SLABS (OCR) LOGIC ───
const slabImgInput = getEl('slabImageInputFile');

getEl('slabImageInput').addEventListener('click', () => {
    slabImgInput.removeAttribute('capture');
    slabImgInput.click();
});

getEl('slabCameraBtn').addEventListener('click', () => {
    slabImgInput.setAttribute('capture', 'environment');
    slabImgInput.click();
});

slabImgInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        const url = URL.createObjectURL(e.target.files[0]);
        getEl('slabImagePreview').innerHTML = `<img src="${url}" style="max-width:100%; border-radius:8px;" />`;
        getEl('slabOcrBtn').disabled = false;
        getEl('ocrStatus').className = 'ocr-status hidden';
    }
});

getEl('slabOcrBtn').addEventListener('click', () => {
    const imgEl = getEl('slabImagePreview').querySelector('img');
    if (!imgEl) return;
    
    const status = getEl('ocrStatus');
    status.textContent = 'Scanning image... Please wait, this takes time.';
    status.className = 'ocr-status loading';
    
    Tesseract.recognize(imgEl.src, 'eng')
        .then(({ data: { text } }) => {
            status.textContent = 'Scan complete. Check parsed numbers below.';
            status.className = 'ocr-status success';
            
            const numbers = text.match(/\d+(\.\d+)?/g);
            if (numbers && numbers.length > 0) {
                alert("Extracted Numbers:\n" + numbers.join(", ") + "\n\nNote: You must manually enter these into the table boxes.");
            } else {
                alert("Could not find clear numbers in the image.");
            }
        })
        .catch(err => {
            status.textContent = 'Scan failed. Image might be too blurry.';
            status.className = 'ocr-status error';
        });
});

// ─── PROFILE TAB LOGIC ───
function updateHeaderAvatar() {
    const data = loadData();
    const avatarImg = getEl('avatarImage');
    const avatarPlaceholder = getEl('avatarPlaceholder');
    if (data && data.profile && data.profile.picture) {
        avatarImg.src = data.profile.picture;
        avatarImg.style.display = 'block';
        avatarPlaceholder.style.display = 'none';
    } else {
        avatarImg.src = '';
        avatarImg.style.display = 'none';
        avatarPlaceholder.style.display = 'flex';
    }
}

function loadProfileSettings() {
    const data = loadData();
    if (data.profile) {
        getEl('profileName').value = data.profile.name || '';
        getEl('profilePhone').value = data.profile.phone || '';
        getEl('profileEmail').value = currentUser ? currentUser.email : (data.profile.email || '');
        
        if (data.profile.picture) {
            getEl('profilePicImg').src = data.profile.picture;
            getEl('profilePicImg').style.display = 'block';
            getEl('profilePicPlaceholder').style.display = 'none';
        } else {
            getEl('profilePicImg').style.display = 'none';
            getEl('profilePicImg').src = '';
            getEl('profilePicPlaceholder').style.display = 'flex';
        }
        updateHeaderAvatar();
    }
}

const picInput = getEl('profilePicInput');

getEl('profilePicUploadBtn').addEventListener('click', () => {
    picInput.removeAttribute('capture');
    picInput.click();
});
getEl('profilePicCameraBtn').addEventListener('click', () => {
    picInput.setAttribute('capture', 'user');
    picInput.click();
});

picInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    if (file.size > 1048576) {
        showToast('Image is too large! Please choose a smaller file (Max 1MB).');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const base64String = event.target.result;
        getEl('profilePicImg').src = base64String;
        getEl('profilePicImg').style.display = 'block';
        getEl('profilePicPlaceholder').style.display = 'none';
        
        const data = loadData();
        if(!data.profile) data.profile = {};
        data.profile.picture = base64String;
        saveData(data);
        updateHeaderAvatar();
        showToast('Picture saved!');
    };
    reader.readAsDataURL(file);
});

getEl('profilePicClearBtn').addEventListener('click', () => {
    getEl('profilePicImg').style.display = 'none';
    getEl('profilePicImg').src = '';
    getEl('profilePicPlaceholder').style.display = 'flex';
    
    const data = loadData();
    if(data.profile) data.profile.picture = null;
    saveData(data);
    updateHeaderAvatar();
    showToast('Picture removed!');
});

getEl('saveProfileBtn').addEventListener('click', () => {
    const data = loadData();
    if (!data.profile) data.profile = {};
    data.profile.name = getEl('profileName').value;
    data.profile.phone = getEl('profilePhone').value;
    data.profile.email = getEl('profileEmail').value;
    saveData(data);
    showToast('Profile saved successfully!');
});

// ─── HISTORY TAB LOGIC ───
function getCycleName(dateStr, startDay) {
    const d = new Date(dateStr);
    let year = d.getFullYear();
    let month = d.getMonth();
    let day = d.getDate();

    if (day < startDay) {
        month -= 1;
        if (month < 0) { month = 11; year -= 1; }
    }

    const startDate = new Date(year, month, startDay);
    const endDate = new Date(year, month + 1, startDay - 1);
    
    const sortKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    
    const options = { month: 'short', day: 'numeric' };
    const label = `${startDate.toLocaleDateString('en-GB', options)} — ${endDate.toLocaleDateString('en-GB', options)}`;
    
    return { sortKey, label };
}

function renderHistoryTab() {
    const data = loadData();
    const shifts = data.shifts || [];
    const settings = data.settings || getDefaultSettings();
    const slabs = data.slabs || getDefaultSlabs();
    const startDay = settings.cycleStartDay || 1;

    const tbody = getEl('historyTableBody');
    
    if (!shifts.length) {
        tbody.innerHTML = '';
        getEl('emptyHistory').style.display = 'block';
        return;
    }
    
    getEl('emptyHistory').style.display = 'none';

    const groupedShifts = {};
    shifts.forEach(shift => {
        if (!shift.date) return;
        const cycleInfo = getCycleName(shift.date, startDay);
        if (!groupedShifts[cycleInfo.sortKey]) {
            groupedShifts[cycleInfo.sortKey] = { label: cycleInfo.label, shifts: [] };
        }
        groupedShifts[cycleInfo.sortKey].shifts.push(shift);
    });

    const sortedKeys = Object.keys(groupedShifts).sort().reverse();

    tbody.innerHTML = sortedKeys.map(key => {
        const group = groupedShifts[key];
        const commData = calculateCommission(group.shifts, settings, slabs);
        return `<tr>
            <td style="font-weight:600;">${group.label}</td>
            <td>${commData.totalCleanMoney.toFixed(2)} AED</td>
            <td style="color:#166534; font-weight:700;">${commData.finalCommission.toFixed(2)} AED</td>
        </tr>`;
    }).join('');
}

// ─── OFFLINE/ONLINE NETWORK STATUS ───
window.addEventListener('offline', () => getEl('offlineBadge').classList.add('show'));
window.addEventListener('online', () => getEl('offlineBadge').classList.remove('show'));


