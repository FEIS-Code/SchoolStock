// ============================================================
// SchoolStock — Inventory Management App
// Five Elements International School — Team Young Champions
// ============================================================

const SPREADSHEET_ID = '1FQSzygdNOaRLmaZfLa9yYYuggTZ4EFgsE29U1dXbxYQ';
const INVENTORY_SHEET = 'Inventory';
const HISTORY_SHEET = 'History';
const CATEGORIES_SHEET = 'Categories';
const LOCATIONS_SHEET = 'Locations';
const USERS_SHEET = 'Users';

function getSheet(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === name.trim().toLowerCase()) return sheets[i];
  }
  return null;
}

function sheetToArray(name) {
  var sheet = getSheet(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return [];
  var h = data[0], rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < h.length; j++) obj[h[j]] = data[i][j];
    rows.push(obj);
  }
  return rows;
}

// --- Web App ---

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'inventory';
  var result;
  switch (action) {
    case 'inventory': result = sheetToArray(INVENTORY_SHEET); break;
    case 'history': result = sheetToArray(HISTORY_SHEET); break;
    case 'categories': result = getList(CATEGORIES_SHEET); break;
    case 'locations': result = getList(LOCATIONS_SHEET); break;
    case 'lowstock': result = getLowStock(); break;
    case 'stats': result = getStats(); break;
    case 'users': result = getUsers(e.parameter.u, e.parameter.p); break;
    default: result = {error:'Unknown'};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    // Login doesn't need pre-auth
    if (data.action === 'login') {
      var loginResult = login(data.username, data.password);
      return ContentService.createTextOutput(JSON.stringify(loginResult)).setMimeType(ContentService.MimeType.JSON);
    }
    
    // All other actions need admin auth
    var authUser = data.auth ? data.auth.username : data.username;
    var authPass = data.auth ? data.auth.password : data.password;
    var auth = login(authUser, authPass);
    if (!auth.success || auth.role !== 'admin') {
      return ContentService.createTextOutput(JSON.stringify({success:false,message:'Unauthorized: '+auth.message})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var result;
    switch (data.action) {
      case 'addItem': result = addItem(data); break;
      case 'updateItem': result = updateItem(data); break;
      case 'deleteItem': result = deleteItem(data); break;
      case 'checkout': result = checkout(data); break;
      case 'checkin': result = checkin(data); break;
      case 'saveCategories': result = saveList(CATEGORIES_SHEET, 'Category', data.items); break;
      case 'saveLocations': result = saveList(LOCATIONS_SHEET, 'Location', data.items); break;
      case 'setupData': setupData(); result = {success:true}; break;
      default: result = {error:'Unknown action: '+data.action};
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.toString(),stack:err.stack})).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- Inventory CRUD ---

function addItem(data) {
  var sheet = getSheet(INVENTORY_SHEET);
  var id = 'ITM-' + Date.now().toString(36).toUpperCase();
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy');
  sheet.appendRow([id, data.name, data.category||'', data.location||'', parseInt(data.quantity)||0, parseInt(data.minStock)||5, 'Available', now, data.notes||'']);
  logHistory(id, data.name, 'ADDED', data.quantity, 'Initial stock', data.auth.username);
  return {success:true, id:id};
}

function updateItem(data) {
  var sheet = getSheet(INVENTORY_SHEET);
  var all = sheet.getDataRange().getDisplayValues();
  var h = all[0];
  for (var i = 1; i < all.length; i++) {
    if (all[i][0] === data.id) {
      var row = i + 1;
      if (data.name !== undefined) sheet.getRange(row, 2).setValue(data.name);
      if (data.category !== undefined) sheet.getRange(row, 3).setValue(data.category);
      if (data.location !== undefined) sheet.getRange(row, 4).setValue(data.location);
      if (data.quantity !== undefined) sheet.getRange(row, 5).setValue(parseInt(data.quantity)||0);
      if (data.minStock !== undefined) sheet.getRange(row, 6).setValue(parseInt(data.minStock)||5);
      if (data.notes !== undefined) sheet.getRange(row, 9).setValue(data.notes);
      return {success:true};
    }
  }
  return {success:false, message:'Not found'};
}

function deleteItem(data) {
  var sheet = getSheet(INVENTORY_SHEET);
  var all = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < all.length; i++) {
    if (all[i][0] === data.id) {
      logHistory(data.id, all[i][1], 'DELETED', all[i][4], 'Item removed', data.auth.username);
      sheet.deleteRow(i + 1);
      return {success:true};
    }
  }
  return {success:false, message:'Not found'};
}

// --- Check-in / Check-out ---

function checkout(data) {
  var sheet = getSheet(INVENTORY_SHEET);
  var all = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < all.length; i++) {
    if (all[i][0] === data.id) {
      var current = parseInt(all[i][4]) || 0;
      var qty = parseInt(data.quantity) || 1;
      if (qty > current) return {success:false, message:'Not enough stock (have '+current+')'};
      var newQty = current - qty;
      sheet.getRange(i+1, 5).setValue(newQty);
      sheet.getRange(i+1, 7).setValue(newQty === 0 ? 'Out of Stock' : 'Available');
      logHistory(data.id, all[i][1], 'CHECK-OUT', qty, (data.borrower||'')+(data.reason?' - '+data.reason:''), data.auth.username);
      return {success:true, remaining:newQty};
    }
  }
  return {success:false, message:'Not found'};
}

function checkin(data) {
  var sheet = getSheet(INVENTORY_SHEET);
  var all = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < all.length; i++) {
    if (all[i][0] === data.id) {
      var current = parseInt(all[i][4]) || 0;
      var qty = parseInt(data.quantity) || 1;
      var newQty = current + qty;
      sheet.getRange(i+1, 5).setValue(newQty);
      sheet.getRange(i+1, 7).setValue('Available');
      logHistory(data.id, all[i][1], 'CHECK-IN', qty, (data.returnedBy||'')+(data.reason?' - '+data.reason:''), data.auth.username);
      return {success:true, total:newQty};
    }
  }
  return {success:false, message:'Not found'};
}

// --- History ---

function logHistory(itemId, itemName, action, qty, notes, user) {
  var sheet = getSheet(HISTORY_SHEET);
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(HISTORY_SHEET);
    sheet.appendRow(['Date','ItemID','ItemName','Action','Quantity','Notes','User']);
  }
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy, hh:mm a');
  sheet.appendRow([now, itemId, itemName, action, String(qty), notes||'', user||'']);
}

// --- Helpers ---

function getList(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getDisplayValues();
  var r = [];
  for (var i = 1; i < data.length; i++) if (data[i][0]) r.push(data[i][0].trim());
  return r;
}

function saveList(sheetName, header, items) {
  var sheet = getSheet(sheetName) || SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(sheetName);
  sheet.clear();
  sheet.appendRow([header]);
  (items||[]).forEach(function(v) { sheet.appendRow([v]); });
  return {success:true};
}

function getLowStock() {
  var all = sheetToArray(INVENTORY_SHEET);
  return all.filter(function(r) { return (parseInt(r.Quantity)||0) <= (parseInt(r.MinStock)||5); });
}

function getStats() {
  var all = sheetToArray(INVENTORY_SHEET);
  var total = all.length, totalQty = 0, lowStock = 0, outOfStock = 0, catCount = {};
  for (var i = 0; i < all.length; i++) {
    var q = parseInt(all[i].Quantity)||0, min = parseInt(all[i].MinStock)||5;
    totalQty += q;
    if (q === 0) outOfStock++;
    else if (q <= min) lowStock++;
    var c = all[i].Category||'Other';
    catCount[c] = (catCount[c]||0) + 1;
  }
  return {totalItems:total, totalQuantity:totalQty, lowStock:lowStock, outOfStock:outOfStock, categories:catCount};
}

function login(username, password) {
  var sheet = getSheet(USERS_SHEET);
  if (!sheet) return {success:false, message:'Users sheet not found'};
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim()===String(username).trim() && String(data[i][1]).trim()===String(password).trim())
      return {success:true, role:String(data[i][2]).trim(), displayName:String(data[i][3]).trim(), username:String(data[i][0]).trim()};
  }
  return {success:false, message:'Invalid credentials'};
}

function getUsers(u, p) {
  var auth = login(u, p);
  if (!auth.success || auth.role !== 'admin') return {error:'Unauthorized'};
  var sheet = getSheet(USERS_SHEET);
  var data = sheet.getDataRange().getValues(), r = [];
  for (var i = 1; i < data.length; i++) if (data[i][0]) r.push({username:String(data[i][0]),password:String(data[i][1]),role:String(data[i][2]),displayName:String(data[i][3])});
  return r;
}

// --- Setup ---

function setupData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var us = ss.getSheetByName(USERS_SHEET)||ss.insertSheet(USERS_SHEET); us.clear();
  us.appendRow(['Username','Password','Role','DisplayName']);
  us.appendRow(['admin','admin123','admin','Administrator']);
  us.appendRow(['manasa','teach123','admin','Ms. Manasa']);

  var cs = ss.getSheetByName(CATEGORIES_SHEET)||ss.insertSheet(CATEGORIES_SHEET); cs.clear();
  cs.appendRow(['Category']);
  ['Stationery','Lab Equipment','Sports Gear','Library Books','Furniture','Electronics','Cleaning Supplies','Art Supplies','Kitchen/Canteen','Other'].forEach(function(c){cs.appendRow([c]);});

  var ls = ss.getSheetByName(LOCATIONS_SHEET)||ss.insertSheet(LOCATIONS_SHEET); ls.clear();
  ls.appendRow(['Location']);
  ['Main Office','Staff Room','Science Lab','Computer Lab','Library','Sports Room','Art Room','Store Room','Cafeteria','Classroom Block A','Classroom Block B'].forEach(function(l){ls.appendRow([l]);});

  var inv = ss.getSheetByName(INVENTORY_SHEET)||ss.insertSheet(INVENTORY_SHEET); inv.clear();
  inv.appendRow(['ID','Name','Category','Location','Quantity','MinStock','Status','DateAdded','Notes']);
  // Sample data
  var samples = [
    ['Whiteboard Markers','Stationery','Staff Room',50,10,'Available','Expo brand, assorted colors'],
    ['Chalk Boxes','Stationery','Store Room',30,10,'Available','White and colored'],
    ['Footballs','Sports Gear','Sports Room',8,3,'Available','Size 5'],
    ['Microscopes','Lab Equipment','Science Lab',12,5,'Available','Compound microscopes'],
    ['Laptops','Electronics','Computer Lab',25,5,'Available','Dell Chromebooks'],
    ['First Aid Kits','Other','Main Office',5,2,'Available','Fully stocked'],
    ['Mops & Buckets','Cleaning Supplies','Store Room',10,5,'Available',''],
    ['Drawing Sheets (packs)','Art Supplies','Art Room',20,8,'Available','A3 size'],
  ];
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy');
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    var id = 'ITM-' + (Date.now() + i).toString(36).toUpperCase();
    inv.appendRow([id, s[0], s[1], s[2], s[3], s[4], s[5], now, s[6]]);
  }

  var hs = ss.getSheetByName(HISTORY_SHEET)||ss.insertSheet(HISTORY_SHEET); hs.clear();
  hs.appendRow(['Date','ItemID','ItemName','Action','Quantity','Notes','User']);

  Logger.log('Setup complete');
}
