/* Shared shell behaviour for the v2 mockups. Static, no server.
   Handles: dismiss on agent cards, links from cards, confirm step, toast,
   avatar menu, agent drawer chat, palette actions.
   Attributes: data-link="page.html#x", data-say="toast text",
   data-confirm="Title||Body||Button||Toast after confirm". */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function icons() { if (window.lucide) lucide.createIcons(); }

  /* toast */
  var tEl, tT;
  function say(t) {
    if (!tEl) { tEl = document.createElement('div'); tEl.className = 'sx-toast'; tEl.setAttribute('role', 'status'); document.body.appendChild(tEl); }
    tEl.textContent = t; tEl.classList.add('on'); clearTimeout(tT); tT = setTimeout(function () { tEl.classList.remove('on'); }, 2800);
  }
  window.shellSay = say;

  /* confirm dialog (first release: a card opens a screen, a person confirms) */
  var cv;
  function confirmBox(title, body, btn, after) {
    if (!cv) {
      cv = document.createElement('div'); cv.className = 'sx-veil';
      cv.innerHTML = '<div class="sx-modal" role="dialog" aria-modal="true" aria-label="Confirm"><h3></h3><p></p><div class="sx-act"><button class="btn" data-x>Cancel</button><button class="btn pri" data-ok></button></div></div>';
      document.body.appendChild(cv);
      cv.addEventListener('click', function (e) { if (e.target === cv || e.target.hasAttribute('data-x')) cv.classList.remove('on'); });
    }
    $('h3', cv).textContent = title; $('p', cv).textContent = body; var ok = $('[data-ok]', cv); ok.textContent = btn || 'Confirm';
    ok.onclick = function () { cv.classList.remove('on'); if (typeof after === 'function') after(); else say(after || 'Done. Sample only.'); };
    cv.classList.add('on'); ok.focus();
  }
  window.shellConfirm = confirmBox;

  document.addEventListener('click', function (e) {
    var t = e.target;
    var c = t.closest && t.closest('[data-confirm]');
    if (c) { var p = c.dataset.confirm.split('||'); confirmBox(p[0], p[1], p[2], p[3]); return; }
    var l = t.closest && t.closest('[data-link]'); if (l) { location.href = l.dataset.link; return; }
    var s = t.closest && t.closest('[data-say]'); if (s) { say(s.dataset.say); return; }
    /* dismiss on agent cards */
    var m = t.closest && t.closest('.insight .act .mini');
    if (m && /^(Dismiss|Ignore)$/.test(m.textContent.trim())) {
      var card = m.closest('.insight'), box = card.parentNode; card.remove();
      var h = box.closest('.card') && $('.ct h3', box.closest('.card'));
      var n = $$('.insight', box).length;
      if (h && /^\s*Agent found/.test(h.textContent.replace(/\s+/g, ' ').replace(/^\s+/, ''))) {
        var sp = $('span', h) || h; var tx = n ? 'Agent found ' + n + (n === 1 ? ' thing' : ' things') : 'Nothing new from the agent';
        if (sp === h) { h.lastChild.textContent = ' ' + tx; } else { sp.textContent = tx; }
        if (!n) box.innerHTML = '<div style="padding:14px 20px;color:var(--ink-3)">All cleared.</div>';
      }
    }
  });

  /* avatar menu */
  var av = $('.top > .avatar');
  if (av) {
    av.style.cursor = 'pointer'; av.setAttribute('role', 'button'); av.setAttribute('tabindex', '0'); av.setAttribute('aria-label', 'Account menu');
    var menu = document.createElement('div'); menu.className = 'sx-menu'; menu.hidden = true;
    menu.innerHTML = '<div class="sx-who"><b>Manny</b><small>Owner · all roles</small></div><a href="settings.html#profile">Profile</a><a href="settings.html#security">Security</a><a href="inbox.html#settings">Notification settings</a><button data-so>Sign out</button>';
    document.body.appendChild(menu);
    var toggle = function (ev) { ev.stopPropagation(); var r = av.getBoundingClientRect(); menu.style.top = (r.bottom + 8) + 'px'; menu.style.right = Math.max(8, innerWidth - r.right) + 'px'; menu.hidden = !menu.hidden; };
    av.addEventListener('click', toggle); av.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
    document.addEventListener('click', function () { menu.hidden = true; });
    $('[data-so]', menu).onclick = function () { say('Signed out. Sample only.'); };
  }

  /* agent drawer chat: read-only, canned answers */
  var body = $('.dbody'), foot = $('.dfoot .ask');
  function reply(q) {
    var a, link;
    if (/cash/i.test(q)) { a = 'GH₵23.4k is still with agents and 3PLs. 38 delivered orders are unpaid after 8 days.'; link = ['Open Finance', 'finance.html']; }
    else if (/failed/i.test(q)) { a = 'Logiswift has 270 failed or returned orders this month. Its delivery success is 45%, against the 60% target.'; link = ['Open Deliveries', 'deliveries.html']; }
    else if (/not reachable/i.test(q)) { a = '41% of failed orders say "customer not reachable". Logiswift has the most failed orders (270 of 402).'; link = ['Open Deliveries', 'deliveries.html']; }
    else { a = 'I read your live data. This is a sample, so new questions get no answer here. I never change data from a card or a chat. I open the screen and you confirm.'; }
    return '<div class="msg-a"><p>' + esc(a) + '</p>' + (link ? '<p><a class="btn" href="' + link[1] + '" style="padding:6px 12px;font-size:13px">' + link[0] + '</a></p>' : '') + '</div>';
  }
  window.shellAsk = function (q) {
    if (!body || !q) return;
    var d = document.getElementById('drawer'); if (d) d.classList.add('on');
    body.insertAdjacentHTML('beforeend', '<div class="msg-u">' + esc(q) + '</div><div class="tool"><i data-lucide="check-circle-2"></i>Checked your live data</div>' + reply(q));
    body.scrollTop = body.scrollHeight; icons();
  };
  $$('.sugg button').forEach(function (b) { b.addEventListener('click', function () { shellAsk(b.textContent.trim()); }); });
  if (foot) {
    foot.innerHTML = '<input type="text" id="sxAsk" placeholder="Ask about orders, cash, stock or targets…" aria-label="Ask the agent" style="flex:1;border:0;outline:0;background:transparent;color:var(--ink);font:inherit"><button class="send" aria-label="Send"><i data-lucide="arrow-up"></i></button>';
    var inp = $('#sxAsk'), go = function () { var v = inp.value.trim(); if (v) { inp.value = ''; shellAsk(v); } };
    $('.send', foot).onclick = go; inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    icons();
  }

  /* command palette actions */
  $$('.cmdk .it').forEach(function (b) {
    if (b.dataset.href || b.dataset.go) return;
    var t = b.textContent.replace('↵', '').trim();
    b.addEventListener('click', function () {
      var v = document.getElementById('veil'); if (v) v.classList.remove('on');
      if (/Record a 3PL payout/.test(t)) location.href = 'finance.html#payout';
      else if (/stock count/.test(t)) location.href = 'inventory.html#count';
      else shellAsk(t);
    });
  });
  var kq = document.getElementById('kq');
  if (kq) kq.addEventListener('keydown', function (e) { if (e.key === 'Enter' && kq.value.trim()) { var v = document.getElementById('veil'); if (v) v.classList.remove('on'); shellAsk(kq.value.trim()); kq.value = ''; } });
})();
