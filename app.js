'use strict';

/* =====================================================================
   STORE – localStorage でデータ管理
   ===================================================================== */
const STORE = (() => {
  const KEY = 'farm_data';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

  function init() {
    const d = load();
    if (!d.houses)      d.houses      = [];
    if (!d.trees)       d.trees       = [];
    if (!d.workRecords) d.workRecords = [];
    if (!d.treeWork)    d.treeWork    = [];
    if (!d.nextId)      d.nextId      = { house: 1, tree: 1, work: 1 };
    save(d);
    return d;
  }

  function nextId(type) {
    const d = load();
    const id = d.nextId[type]++;
    save(d);
    return id;
  }

  /* --- Houses --- */
  function getHouses()        { return load().houses || []; }
  function getHouse(id)       { return getHouses().find(h => h.id === id); }
  function addHouse(h)        { h.id = nextId('house'); const d=load(); d.houses.push(h); save(d); ensureTrees(h.id,h.rows,h.cols); return h; }
  function updateHouse(h)     { const d=load(); const i=d.houses.findIndex(x=>x.id===h.id); if(i>=0){d.houses[i]=h; save(d);} }
  function deleteHouse(id)    {
    const d=load();
    const trees = d.trees.filter(t=>t.houseId===id);
    const treeIds = trees.map(t=>t.id);
    const workIds = d.workRecords.filter(w=>w.houseId===id).map(w=>w.id);
    d.houses      = d.houses.filter(h=>h.id!==id);
    d.trees       = d.trees.filter(t=>t.houseId!==id);
    d.workRecords = d.workRecords.filter(w=>w.houseId!==id);
    d.treeWork    = d.treeWork.filter(tw=>!workIds.includes(tw.workId)&&!treeIds.includes(tw.treeId));
    save(d);
    // 写真も削除
    treeIds.forEach(tid => PHOTO_DB.deleteByTree(tid));
  }

  /* --- Trees --- */
  function getTrees(houseId)  { return load().trees.filter(t=>t.houseId===houseId); }
  function getTree(id)        { return load().trees.find(t=>t.id===id); }
  function updateTree(t)      { const d=load(); const i=d.trees.findIndex(x=>x.id===t.id); if(i>=0){d.trees[i]=t; save(d);} }

  function ensureTrees(houseId, rows, cols) {
    const d=load();
    for (let r=1;r<=rows;r++) for (let c=1;c<=cols;c++) {
      if (!d.trees.find(t=>t.houseId===houseId&&t.row===r&&t.col===c)) {
        d.trees.push({id:d.nextId.tree++, houseId, row:r, col:c, label:'', variety:'', status:'normal', notes:''});
      }
    }
    save(d);
  }

  /* --- Work Records --- */
  function getWorks(houseId)  { return load().workRecords.filter(w=>w.houseId===houseId); }
  function getWork(id)        { return load().workRecords.find(w=>w.id===id); }
  function addWork(w)         {
    w.id = nextId('work');
    w.createdAt = now();
    const d=load();
    d.workRecords.push(w);
    // 全ての木に未完了エントリ追加
    d.trees.filter(t=>t.houseId===w.houseId).forEach(t=>{
      if(!d.treeWork.find(tw=>tw.workId===w.id&&tw.treeId===t.id))
        d.treeWork.push({workId:w.id, treeId:t.id, completed:false, completedAt:''});
    });
    save(d);
    return w;
  }
  function deleteWork(id)     { const d=load(); d.workRecords=d.workRecords.filter(w=>w.id!==id); d.treeWork=d.treeWork.filter(tw=>tw.workId!==id); save(d); }

  /* --- Tree Work (チェック) --- */
  function getTreeWork(workId) { return load().treeWork.filter(tw=>tw.workId===workId); }
  function toggleTreeWork(workId, treeId) {
    const d=load();
    const tw=d.treeWork.find(x=>x.workId===workId&&x.treeId===treeId);
    if(tw){ tw.completed=!tw.completed; tw.completedAt=tw.completed?now():''; }
    save(d);
  }
  function checkAll(workId, completed) {
    const d=load(); const n=completed?now():'';
    d.treeWork.filter(tw=>tw.workId===workId).forEach(tw=>{tw.completed=completed;tw.completedAt=n;});
    save(d);
  }
  function getTreeWorkForTree(treeId) {
    const d=load();
    return d.treeWork.filter(tw=>tw.treeId===treeId).map(tw=>{
      const w=d.workRecords.find(x=>x.id===tw.workId);
      return {...tw, workName:w?.name||'', workType:w?.type||'', workDate:w?.date||''};
    });
  }

  function now() { return new Date().toLocaleString('ja-JP'); }

  return {
    init, getHouses, getHouse, addHouse, updateHouse, deleteHouse,
    getTrees, getTree, updateTree, ensureTrees,
    getWorks, getWork, addWork, deleteWork,
    getTreeWork, toggleTreeWork, checkAll, getTreeWorkForTree
  };
})();


/* =====================================================================
   PHOTO_DB – IndexedDB で写真管理
   ===================================================================== */
const PHOTO_DB = (() => {
  const DB_NAME = 'farmPhotos', STORE_NAME = 'photos', DB_VER = 1;
  let db = null;

  function open() {
    return new Promise((res, rej) => {
      if (db) return res(db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME, {keyPath:'id', autoIncrement:true});
      req.onsuccess = e => { db = e.target.result; res(db); };
      req.onerror   = e => rej(e);
    });
  }

  async function add(treeId, dataUrl, caption) {
    const d = await open();
    return new Promise((res,rej)=>{
      const tx = d.transaction(STORE_NAME,'readwrite');
      const req = tx.objectStore(STORE_NAME).add({treeId, dataUrl, caption, createdAt: new Date().toLocaleString('ja-JP')});
      req.onsuccess = ()=>res(req.result);
      req.onerror   = ()=>rej(req.error);
    });
  }

  async function getByTree(treeId) {
    const d = await open();
    return new Promise((res,rej)=>{
      const all=[];
      d.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).openCursor().onsuccess = e=>{
        const cursor=e.target.result;
        if(cursor){ if(cursor.value.treeId===treeId) all.push(cursor.value); cursor.continue(); }
        else res(all.reverse());
      };
    });
  }

  async function remove(id) {
    const d = await open();
    return new Promise((res)=>{
      d.transaction(STORE_NAME,'readwrite').objectStore(STORE_NAME).delete(id).onsuccess=()=>res();
    });
  }

  async function deleteByTree(treeId) {
    const photos = await getByTree(treeId);
    for (const p of photos) await remove(p.id);
  }

  return { add, getByTree, remove, deleteByTree };
})();


/* =====================================================================
   UTILS
   ===================================================================== */
function flash(msg, type='success') {
  const wrap = document.getElementById('flash-wrap');
  const div = document.createElement('div');
  div.className = `alert alert-${type} alert-dismissible fade show shadow`;
  div.innerHTML = msg + `<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  wrap.appendChild(div);
  setTimeout(()=>{ try{bootstrap.Alert.getOrCreateInstance(div).close();}catch{div.remove();} }, 3000);
}

function $(sel, ctx=document) { return ctx.querySelector(sel); }

function statusLabel(s) {
  return {normal:'正常', caution:'要観察', sick:'異常', dead:'枯死'}[s]||s;
}
function statusBadgeClass(s) {
  return {normal:'bg-success', caution:'bg-warning text-dark', sick:'bg-danger', dead:'bg-secondary'}[s]||'bg-secondary';
}
function workTypeLabel(t) {
  return {pesticide:'農薬散布', fertilizer:'施肥', pruning:'剪定', other:'その他'}[t]||t;
}
function workTypeBadgeClass(t) {
  return {pesticide:'bg-warning text-dark', fertilizer:'bg-info text-dark', pruning:'bg-success', other:'bg-secondary'}[t]||'bg-secondary';
}
function workTypeIcon(t) {
  return {pesticide:'bug-fill', fertilizer:'moisture', pruning:'scissors', other:'tools'}[t]||'tools';
}

async function resizeImage(file, maxW=900) {
  return new Promise(res=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      const r=Math.min(1,maxW/img.width);
      const c=document.createElement('canvas');
      c.width=img.width*r; c.height=img.height*r;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg',0.75));
    };
    img.src=url;
  });
}


/* =====================================================================
   ROUTER
   ===================================================================== */
const ROUTER = {
  routes: [],
  add(pattern, handler) { this.routes.push({pattern, handler}); },
  dispatch() {
    const hash = location.hash.replace(/^#\/?/,'') || '';
    for (const {pattern, handler} of this.routes) {
      const m = hash.match(pattern);
      if (m) { handler(...m.slice(1)); return; }
    }
    VIEWS.houseList();
  }
};

window.addEventListener('hashchange', ()=>ROUTER.dispatch());


/* =====================================================================
   VIEWS
   ===================================================================== */
const VIEWS = {
  render(html) { document.getElementById('app').innerHTML = html; window.scrollTo(0,0); },

  /* ── ハウス一覧 ── */
  houseList() {
    const houses = STORE.getHouses();
    const cards = houses.length ? houses.map(h=>`
      <div class="col-12 col-sm-6 col-md-4">
        <div class="card h-100">
          <div class="card-body d-flex flex-column gap-2 p-3">
            <div class="d-flex align-items-start">
              <div>
                <div class="fs-5 fw-bold">${h.name}</div>
                <div class="text-muted small">${h.rows}列 × ${h.cols}本 = 合計 ${h.rows*h.cols}本</div>
              </div>
              <span class="ms-auto badge bg-success fs-6 rounded-pill px-3">${h.rows*h.cols}本</span>
            </div>
            ${h.notes?`<p class="text-muted small mb-0">${h.notes}</p>`:''}
            <a href="#/house/${h.id}" class="btn btn-farm mt-auto">
              <i class="bi bi-arrow-right-circle me-1"></i>管理する
            </a>
          </div>
        </div>
      </div>`).join('')
    : `<div class="text-center py-5 col-12">
        <i class="bi bi-tree display-1 text-muted"></i>
        <p class="mt-3 text-muted fs-5">ハウスがまだありません</p>
        <a href="#/house/new" class="btn btn-farm btn-lg"><i class="bi bi-plus-lg me-1"></i>最初のハウスを追加する</a>
      </div>`;

    this.render(`
      <div class="d-flex align-items-center mb-4 gap-3">
        <h2 class="fw-bold mb-0"><i class="bi bi-grid-3x3-gap-fill me-2 text-success"></i>ハウス一覧</h2>
        <a href="#/house/new" class="btn btn-farm ms-auto"><i class="bi bi-plus-lg me-1"></i>ハウスを追加</a>
      </div>
      <div class="row g-3">${cards}</div>`);
  },

  /* ── ハウス新規・編集 ── */
  houseForm(id) {
    const h = id ? STORE.getHouse(+id) : null;
    const back = h ? `#/house/${h.id}` : '#/';
    this.render(`
      <div class="mb-3">
        <a href="${back}" class="btn btn-farm-outline"><i class="bi bi-arrow-left me-1"></i>戻る</a>
      </div>
      <div class="card">
        <div class="card-header py-3">
          <h4 class="mb-0"><i class="bi bi-${h?'pencil':'plus-circle'}-fill me-2"></i>${h?'ハウスを編集':'新しいハウスを追加'}</h4>
        </div>
        <div class="card-body p-4">
          <form id="houseForm">
            <div class="mb-4">
              <label class="form-label fw-bold fs-5">ハウス名 <span class="text-danger">*</span></label>
              <input type="text" name="name" class="form-control form-control-lg" placeholder="例：第1ハウス"
                     value="${h?.name||''}" required>
            </div>
            ${!h ? `
            <div class="row g-3 mb-4">
              <div class="col-6">
                <label class="form-label fw-bold">列数（縦）</label>
                <input type="number" name="rows" class="form-control form-control-lg text-center" min="1" max="50" value="5">
                <div class="form-text">縦に何列ありますか？</div>
              </div>
              <div class="col-6">
                <label class="form-label fw-bold">1列あたりの本数（横）</label>
                <input type="number" name="cols" class="form-control form-control-lg text-center" min="1" max="100" value="10">
                <div class="form-text">1列に何本ありますか？</div>
              </div>
            </div>` : ''}
            <div class="mb-4">
              <label class="form-label fw-bold">メモ</label>
              <textarea name="notes" class="form-control" rows="3" placeholder="このハウスについての説明など">${h?.notes||''}</textarea>
            </div>
            <button type="submit" class="btn btn-farm btn-lg w-100">
              <i class="bi bi-check-lg me-1"></i>${h?'保存する':'ハウスを作成する'}
            </button>
          </form>
        </div>
      </div>`);

    $('#houseForm').addEventListener('submit', e=>{
      e.preventDefault();
      const f = new FormData(e.target);
      if (h) {
        STORE.updateHouse({...h, name:f.get('name'), notes:f.get('notes')});
        flash('保存しました');
        location.hash = `#/house/${h.id}`;
      } else {
        const nh = STORE.addHouse({name:f.get('name'), rows:+f.get('rows'), cols:+f.get('cols'), notes:f.get('notes')});
        flash(`ハウス「${nh.name}」を作成しました`);
        location.hash = `#/house/${nh.id}`;
      }
    });
  },

  /* ── ハウス詳細 ── */
  houseDetail(id) {
    id = +id;
    const h = STORE.getHouse(id);
    if (!h) { flash('ハウスが見つかりません','danger'); location.hash='#/'; return; }
    const trees = STORE.getTrees(id);
    const tmap = {};
    trees.forEach(t=>tmap[`${t.row}-${t.col}`]=t);
    const works = STORE.getWorks(id).slice().reverse().slice(0,5);

    let gridRows='';
    let colHeads='<th class="row-label"></th>';
    for(let c=1;c<=h.cols;c++) colHeads+=`<th style="width:56px;text-align:center;font-size:.7rem;color:#6c757d;padding-bottom:4px;">${c}</th>`;

    for(let r=1;r<=h.rows;r++){
      let cells='';
      for(let c=1;c<=h.cols;c++){
        const t=tmap[`${r}-${c}`];
        if(t) cells+=`<td><a href="#/tree/${t.id}" class="tree-cell ${t.status}">
          <i class="bi bi-tree-fill" style="font-size:1.1rem;"></i>
          <span>${t.label||(r+'-'+c)}</span></a></td>`;
      }
      gridRows+=`<tr><td class="row-label">${r}列</td>${cells}</tr>`;
    }

    const workItems = works.length ? works.map(w=>`
      <a href="#/house/${id}/work/${w.id}" class="list-group-item list-group-item-action d-flex align-items-center gap-3 px-0">
        <span class="badge rounded-pill px-3 py-2 ${workTypeBadgeClass(w.type)}">${workTypeLabel(w.type)}</span>
        <div class="flex-grow-1">
          <div class="fw-bold">${w.name}</div>
          ${w.date?`<div class="text-muted small">予定日: ${w.date}</div>`:''}
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </a>`).join('')
    : '<p class="text-muted text-center py-3 mb-0">作業記録はまだありません</p>';

    this.render(`
      <div class="d-flex align-items-center mb-3 gap-2 flex-wrap">
        <a href="#/" class="btn btn-farm-outline"><i class="bi bi-arrow-left me-1"></i>一覧</a>
        <h2 class="fw-bold mb-0 ms-1"><i class="bi bi-tree-fill me-2 text-success"></i>${h.name}</h2>
        <div class="ms-auto d-flex gap-2">
          <a href="#/house/${id}/work/new" class="btn btn-warning"><i class="bi bi-clipboard-check me-1"></i>作業を登録</a>
          <a href="#/house/${id}/edit" class="btn btn-farm-outline"><i class="bi bi-pencil me-1"></i>編集</a>
        </div>
      </div>
      <div class="text-muted small mb-3">${h.rows}列 × ${h.cols}本 = 合計 ${h.rows*h.cols}本${h.notes?' ／ '+h.notes:''}</div>

      <div class="d-flex gap-3 mb-3 flex-wrap align-items-center">
        <span class="fw-bold small">ステータス:</span>
        <span class="badge badge-normal rounded-pill px-3 py-2">正常</span>
        <span class="badge badge-caution rounded-pill px-3 py-2">要観察</span>
        <span class="badge badge-sick rounded-pill px-3 py-2">異常</span>
        <span class="badge badge-dead rounded-pill px-3 py-2">枯死</span>
      </div>

      <div class="card mb-4">
        <div class="card-header py-2"><i class="bi bi-grid me-2"></i>木の配置マップ（タップで詳細）</div>
        <div class="card-body p-3 tree-grid">
          <table><thead><tr>${colHeads}</tr></thead><tbody>${gridRows}</tbody></table>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header py-2 d-flex align-items-center justify-content-between">
          <span><i class="bi bi-clipboard-check me-2"></i>最近の作業記録</span>
          <a href="#/house/${id}/work/new" class="btn btn-sm btn-light"><i class="bi bi-plus me-1"></i>追加</a>
        </div>
        <div class="card-body p-3">
          <div class="list-group list-group-flush">${workItems}</div>
        </div>
      </div>

      <div class="text-end mt-4">
        <button class="btn btn-outline-danger btn-sm" id="delToggle"><i class="bi bi-trash me-1"></i>このハウスを削除</button>
        <div id="delConfirm" class="d-none mt-2">
          <div class="alert alert-danger">
            本当に削除しますか？すべての木・写真・作業記録が消えます。
            <div class="mt-2 d-flex gap-2 justify-content-end">
              <button class="btn btn-sm btn-secondary" id="delCancel">キャンセル</button>
              <button class="btn btn-sm btn-danger" id="delConfirmBtn">削除する</button>
            </div>
          </div>
        </div>
      </div>`);

    $('#delToggle').onclick = ()=>$('#delConfirm').classList.toggle('d-none');
    $('#delCancel').onclick = ()=>$('#delConfirm').classList.add('d-none');
    $('#delConfirmBtn').onclick = ()=>{
      STORE.deleteHouse(id);
      flash(`ハウス「${h.name}」を削除しました`);
      location.hash='#/';
    };
  },

  /* ── 木詳細 ── */
  async treeDetail(id) {
    id = +id;
    const t = STORE.getTree(id);
    if (!t) { flash('木が見つかりません','danger'); location.hash='#/'; return; }
    const h = STORE.getHouse(t.houseId);
    const treeName = t.label || `${t.row}列${t.col}番`;
    const photos = await PHOTO_DB.getByTree(id);
    const workStatuses = STORE.getTreeWorkForTree(id);

    const photoCards = photos.map(p=>`
      <div class="col-6 col-sm-4 col-md-3">
        <div class="card border-0 shadow-sm">
          <a href="${p.dataUrl}" target="_blank">
            <img src="${p.dataUrl}" class="photo-thumb card-img-top" alt="${p.caption}">
          </a>
          <div class="card-body p-2">
            ${p.caption?`<p class="small mb-1 text-muted">${p.caption}</p>`:''}
            <p class="small mb-1 text-muted" style="font-size:.7rem;">${p.createdAt}</p>
            <button class="btn btn-sm btn-outline-danger w-100 del-photo" data-id="${p.id}">
              <i class="bi bi-trash"></i> 削除
            </button>
          </div>
        </div>
      </div>`).join('');

    const workRows = workStatuses.map(ws=>`
      <div class="list-group-item d-flex align-items-center gap-3 px-0">
        <i class="bi bi-${ws.completed?'check-circle-fill text-success':'circle text-muted'} fs-5"></i>
        <div class="flex-grow-1">
          <div class="fw-bold small">${ws.workName}</div>
          ${ws.workDate?`<div class="text-muted" style="font-size:.75rem;">予定日: ${ws.workDate}</div>`:''}
          ${ws.completedAt?`<div class="text-success" style="font-size:.75rem;">完了: ${ws.completedAt}</div>`:''}
        </div>
        <span class="badge ${ws.completed?'bg-success':'bg-light text-dark border'}">${ws.completed?'完了':'未完了'}</span>
      </div>`).join('');

    this.render(`
      <div class="d-flex align-items-center mb-3 gap-2">
        <a href="#/house/${h.id}" class="btn btn-farm-outline"><i class="bi bi-arrow-left me-1"></i>${h.name}</a>
        <h2 class="fw-bold mb-0 ms-1"><i class="bi bi-tree-fill me-2 text-success"></i>${treeName}</h2>
      </div>

      <div class="alert alert-light border mb-3 py-2 px-3 d-flex align-items-center gap-3">
        <i class="bi bi-geo-alt-fill text-success fs-5"></i>
        <div><span class="fw-bold">${h.name}</span> ／ ${t.row}列目 ${t.col}番目</div>
        <span class="ms-auto badge rounded-pill px-3 py-2 ${statusBadgeClass(t.status)}">${statusLabel(t.status)}</span>
      </div>

      <div class="card mb-4">
        <div class="card-header py-2"><i class="bi bi-pencil-fill me-2"></i>木の情報</div>
        <div class="card-body p-3">
          <form id="treeForm">
            <div class="row g-3 mb-3">
              <div class="col-6">
                <label class="form-label fw-bold">名前・番号</label>
                <input type="text" name="label" class="form-control form-control-lg"
                       placeholder="${t.row}-${t.col}" value="${t.label}">
              </div>
              <div class="col-6">
                <label class="form-label fw-bold">品種</label>
                <input type="text" name="variety" class="form-control form-control-lg"
                       placeholder="例：アーウィン" value="${t.variety}">
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">ステータス</label>
              <div class="d-flex gap-2 flex-wrap">
                ${[['normal','正常','success'],['caution','要観察','warning'],['sick','異常','danger'],['dead','枯死','secondary']].map(([v,l,c])=>`
                <div class="form-check">
                  <input class="form-check-input" type="radio" name="status" id="s_${v}" value="${v}" ${t.status===v?'checked':''}>
                  <label class="form-check-label" for="s_${v}">
                    <span class="badge bg-${c} px-3 py-2">${l}</span>
                  </label>
                </div>`).join('')}
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label fw-bold">メモ・観察記録</label>
              <textarea name="notes" class="form-control" rows="4"
                        placeholder="気になること、観察したことを書いてください">${t.notes}</textarea>
            </div>
            <button type="submit" class="btn btn-farm w-100"><i class="bi bi-check-lg me-1"></i>保存する</button>
          </form>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header py-2"><i class="bi bi-camera-fill me-2"></i>写真（${photos.length}枚）</div>
        <div class="card-body p-3">
          <form id="photoForm" class="mb-3">
            <div class="row g-2 align-items-end">
              <div class="col-12 col-sm-5">
                <label class="form-label fw-bold small">写真を選ぶ</label>
                <input type="file" name="photo" id="photoInput" class="form-control" accept="image/*" capture="environment">
              </div>
              <div class="col-12 col-sm-5">
                <label class="form-label fw-bold small">コメント（任意）</label>
                <input type="text" name="caption" class="form-control" placeholder="例：葉の変色あり">
              </div>
              <div class="col-12 col-sm-2">
                <button type="submit" class="btn btn-farm w-100"><i class="bi bi-upload me-1"></i>追加</button>
              </div>
            </div>
          </form>
          ${photos.length ? `<div class="row g-2">${photoCards}</div>`
            : '<p class="text-muted text-center py-3 mb-0"><i class="bi bi-camera display-6 d-block mb-2"></i>写真はまだありません</p>'}
        </div>
      </div>

      ${workStatuses.length ? `
      <div class="card mb-4">
        <div class="card-header py-2"><i class="bi bi-clipboard-check me-2"></i>作業チェック履歴</div>
        <div class="card-body p-3">
          <div class="list-group list-group-flush">${workRows}</div>
        </div>
      </div>` : ''}`);

    // 木情報保存
    $('#treeForm').addEventListener('submit', e=>{
      e.preventDefault();
      const f = new FormData(e.target);
      STORE.updateTree({...t, label:f.get('label'), variety:f.get('variety'),
                        status:f.get('status'), notes:f.get('notes')});
      flash('保存しました');
      VIEWS.treeDetail(id);
    });

    // 写真追加
    $('#photoForm').addEventListener('submit', async e=>{
      e.preventDefault();
      const file = document.getElementById('photoInput').files[0];
      if (!file) { flash('写真を選択してください','warning'); return; }
      const caption = e.target.caption.value;
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>処理中...';
      try {
        const dataUrl = await resizeImage(file);
        await PHOTO_DB.add(id, dataUrl, caption);
        flash('写真を追加しました');
        VIEWS.treeDetail(id);
      } catch(err) {
        flash('写真の追加に失敗しました','danger');
        btn.disabled = false; btn.innerHTML = '<i class="bi bi-upload me-1"></i>追加';
      }
    });

    // 写真削除
    document.querySelectorAll('.del-photo').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if (!confirm('この写真を削除しますか？')) return;
        await PHOTO_DB.remove(+btn.dataset.id);
        flash('写真を削除しました');
        VIEWS.treeDetail(id);
      });
    });
  },

  /* ── 作業登録フォーム ── */
  workForm(houseId) {
    houseId = +houseId;
    const h = STORE.getHouse(houseId);
    if (!h) { location.hash='#/'; return; }
    this.render(`
      <div class="mb-3">
        <a href="#/house/${houseId}" class="btn btn-farm-outline"><i class="bi bi-arrow-left me-1"></i>${h.name}</a>
      </div>
      <div class="card">
        <div class="card-header py-3">
          <h4 class="mb-0"><i class="bi bi-clipboard-plus-fill me-2"></i>作業を登録する</h4>
          <div class="small mt-1 opacity-75">${h.name} の全 ${h.rows*h.cols}本 に対して</div>
        </div>
        <div class="card-body p-4">
          <form id="workForm">
            <div class="mb-4">
              <label class="form-label fw-bold fs-5">作業の種類</label>
              <div class="row g-2">
                ${[['pesticide','bug','農薬散布','warning'],['fertilizer','moisture','施肥','info'],
                   ['pruning','scissors','剪定','success'],['other','tools','その他','secondary']].map(([v,ic,l,c],i)=>`
                <div class="col-6">
                  <input type="radio" class="btn-check" name="work_type" id="wt_${v}" value="${v}" ${i===0?'checked':''}>
                  <label class="btn btn-outline-${c} w-100 py-3 d-flex flex-column align-items-center gap-1" for="wt_${v}">
                    <i class="bi bi-${ic}-fill fs-3"></i><span class="fw-bold">${l}</span>
                  </label>
                </div>`).join('')}
              </div>
            </div>
            <div class="mb-4">
              <label class="form-label fw-bold fs-5">作業名 <span class="text-danger">*</span></label>
              <input type="text" name="work_name" class="form-control form-control-lg"
                     placeholder="例：第1回 農薬散布（〇〇剤）" required>
            </div>
            <div class="mb-4">
              <label class="form-label fw-bold fs-5">予定日（任意）</label>
              <input type="date" name="work_date" class="form-control form-control-lg">
            </div>
            <div class="mb-4">
              <label class="form-label fw-bold">メモ（薬剤名・希釈倍率など）</label>
              <textarea name="notes" class="form-control" rows="3"
                        placeholder="例：スミチオン 1000倍 ／ 10Lタンク 3回分"></textarea>
            </div>
            <button type="submit" class="btn btn-farm btn-lg w-100">
              <i class="bi bi-check-lg me-1"></i>作業を登録して一覧を開く
            </button>
          </form>
        </div>
      </div>`);

    $('#workForm').addEventListener('submit', e=>{
      e.preventDefault();
      const f = new FormData(e.target);
      const w = STORE.addWork({houseId, name:f.get('work_name'), type:f.get('work_type'),
                                date:f.get('work_date'), notes:f.get('notes')});
      flash(`作業「${w.name}」を登録しました`);
      location.hash = `#/house/${houseId}/work/${w.id}`;
    });
  },

  /* ── 作業チェックリスト ── */
  workDetail(houseId, workId) {
    houseId=+houseId; workId=+workId;
    const h = STORE.getHouse(houseId);
    const w = STORE.getWork(workId);
    if (!h||!w) { flash('見つかりません','danger'); location.hash=`#/house/${houseId}`; return; }

    const trees   = STORE.getTrees(houseId);
    const twList  = STORE.getTreeWork(workId);
    const twMap   = {};
    twList.forEach(tw=>twMap[tw.treeId]=tw);
    const total   = twList.length;
    const done    = twList.filter(tw=>tw.completed).length;
    const pct     = total ? Math.round(done/total*100) : 0;

    let colHeads='<th class="row-label"></th>';
    for(let c=1;c<=h.cols;c++) colHeads+=`<th style="width:56px;text-align:center;font-size:.7rem;color:#6c757d;padding-bottom:4px;">${c}</th>`;

    let gridRows='';
    for(let r=1;r<=h.rows;r++){
      let cells='';
      for(let c=1;c<=h.cols;c++){
        const t=trees.find(x=>x.row===r&&x.col===c);
        if(t){
          const tw=twMap[t.id];
          const isDone=tw?.completed;
          cells+=`<td><button class="work-cell ${isDone?'done':'not-done'} toggle-work"
            data-tree-id="${t.id}" title="${t.label||(r+'-'+c)}">
            ${isDone?'<i class="bi bi-check-lg" style="font-size:1.2rem;"></i>':`<span>${t.label||(r+'-'+c)}</span>`}
          </button></td>`;
        }
      }
      gridRows+=`<tr><td class="row-label">${r}列</td>${cells}</tr>`;
    }

    const doneList = twList.filter(tw=>tw.completed).map(tw=>{
      const t=trees.find(x=>x.id===tw.treeId);
      return `<span class="badge bg-success m-1 px-2 py-2">${t?.label||(t?.row+'-'+t?.col)||'?'}<br><small>${tw.completedAt}</small></span>`;
    }).join('');

    this.render(`
      <div class="d-flex align-items-center mb-3 gap-2 flex-wrap">
        <a href="#/house/${houseId}" class="btn btn-farm-outline"><i class="bi bi-arrow-left me-1"></i>${h.name}</a>
        <h2 class="fw-bold mb-0 ms-1" style="font-size:1.3rem;">
          <i class="bi bi-clipboard-check-fill me-2 text-success"></i>${w.name}
        </h2>
      </div>

      <div class="card mb-3">
        <div class="card-body py-2 px-3 d-flex flex-wrap gap-3 align-items-center">
          <span class="badge rounded-pill px-3 py-2 fs-6 ${workTypeBadgeClass(w.type)}">
            <i class="bi bi-${workTypeIcon(w.type)}-fill me-1"></i>${workTypeLabel(w.type)}
          </span>
          ${w.date?`<div><i class="bi bi-calendar3 me-1 text-muted"></i>予定日: <strong>${w.date}</strong></div>`:''}
          ${w.notes?`<div class="text-muted small w-100">${w.notes}</div>`:''}
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body py-3 px-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold fs-5"><i class="bi bi-check2-circle me-2 text-success"></i>進捗</span>
            <span class="fw-bold fs-4">${done} / ${total}</span>
          </div>
          <div class="progress" style="height:20px;border-radius:10px;">
            <div class="progress-bar bg-success" style="width:${pct}%;border-radius:10px;">
              ${pct>10?pct+'%':''}
            </div>
          </div>
          <div class="mt-2 text-muted small">残り ${total-done}本</div>
        </div>
      </div>

      <div class="d-flex gap-2 mb-3">
        <button class="btn btn-success flex-grow-1" id="checkAll">
          <i class="bi bi-check-all me-1"></i>全て完了にする
        </button>
        <button class="btn btn-outline-secondary flex-grow-1" id="resetAll">
          <i class="bi bi-x-circle me-1"></i>全てリセット
        </button>
      </div>

      <div class="card mb-4">
        <div class="card-header py-2"><i class="bi bi-grid me-2"></i>木ごとのチェック（タップで切り替え）</div>
        <div class="card-body p-3 tree-grid">
          <table><thead><tr>${colHeads}</tr></thead><tbody>${gridRows}</tbody></table>
        </div>
      </div>

      ${doneList?`<div class="card mb-4">
        <div class="card-header py-2 bg-success text-white">
          <i class="bi bi-check-circle-fill me-2"></i>完了済み (${done}本)
        </div>
        <div class="card-body p-2"><div class="d-flex flex-wrap">${doneList}</div></div>
      </div>`:''}

      <div class="text-end mt-2">
        <button class="btn btn-outline-danger btn-sm" id="delWork">
          <i class="bi bi-trash me-1"></i>この作業記録を削除
        </button>
      </div>`);

    // チェック切替
    document.querySelectorAll('.toggle-work').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        STORE.toggleTreeWork(workId, +btn.dataset.treeId);
        VIEWS.workDetail(houseId, workId);
      });
    });

    $('#checkAll').onclick = ()=>{ STORE.checkAll(workId,true); VIEWS.workDetail(houseId,workId); };
    $('#resetAll').onclick = ()=>{ STORE.checkAll(workId,false); VIEWS.workDetail(houseId,workId); };
    $('#delWork').onclick  = ()=>{
      if (!confirm('この作業記録を削除しますか？')) return;
      STORE.deleteWork(workId);
      flash('作業記録を削除しました');
      location.hash=`#/house/${houseId}`;
    };
  }
};


/* =====================================================================
   ROUTING 設定 & 起動
   ===================================================================== */
ROUTER.add(/^$/, ()=>VIEWS.houseList());
ROUTER.add(/^house\/new$/, ()=>VIEWS.houseForm(null));
ROUTER.add(/^house\/(\d+)$/, id=>VIEWS.houseDetail(id));
ROUTER.add(/^house\/(\d+)\/edit$/, id=>VIEWS.houseForm(id));
ROUTER.add(/^tree\/(\d+)$/, id=>VIEWS.treeDetail(id));
ROUTER.add(/^house\/(\d+)\/work\/new$/, hid=>VIEWS.workForm(hid));
ROUTER.add(/^house\/(\d+)\/work\/(\d+)$/, (hid,wid)=>VIEWS.workDetail(hid,wid));

STORE.init();
ROUTER.dispatch();
