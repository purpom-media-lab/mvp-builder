/**
 * 公開プロト(/run)に注入するフィードバック・ウィジェット。
 *
 * プロト画面の右下にフローティングボタンを出し、開くと JTBD インタビューの
 * チャットパネルが立ち上がる。匿名の回答者ごとに respondentId(localStorage) を割り、
 * 公開 API `/api/run/{projectId}/interview` と往復する。React に依存しないバニラ JS。
 *
 * apiOrigin: 別オリジン（ユーザーの Vercel 等）配信時に API をビルダーの絶対URLへ
 * 向けるためのオリジン。省略時は相対パス＝同一オリジン配信（/run）。
 */
export function buildFeedbackWidget(projectId: string, apiOrigin = ""): string {
  const pid = JSON.stringify(projectId);
  const origin = JSON.stringify(apiOrigin.replace(/\/+$/, ""));
  const GREETING =
    "試していただきありがとうございます！少しだけ感想を聞かせてください。まず、どんな場面でこれを使いたい / あったら便利だと思いましたか？";
  const greeting = JSON.stringify(GREETING);
  return `(function(){
  var PROJECT_ID = ${pid};
  var URL = ${origin} + "/api/run/" + PROJECT_ID + "/interview";
  var RID_KEY = "lq_respondent_id";
  var GREETING = ${greeting};

  function respondentId(){
    try {
      var k = localStorage.getItem(RID_KEY);
      if (!k) {
        k = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem(RID_KEY, k);
      }
      return k;
    } catch (e) {
      return "anon-" + Math.random().toString(36).slice(2);
    }
  }

  // role:'assistant'|'user', content:string
  var messages = [{ role: "assistant", content: GREETING }];
  var sending = false;
  var done = false;

  var css = ""
    + ".lqfb-btn{position:fixed;right:20px;bottom:20px;z-index:2147483600;border:none;border-radius:9999px;"
    + "padding:12px 18px;font:600 14px system-ui,-apple-system,sans-serif;color:#fff;background:#4f46e5;"
    + "box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;}"
    + ".lqfb-panel{position:fixed;right:20px;bottom:20px;z-index:2147483601;width:360px;max-width:calc(100vw - 32px);"
    + "height:520px;max-height:calc(100vh - 32px);display:none;flex-direction:column;background:#fff;color:#111;"
    + "border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;font:14px system-ui,-apple-system,sans-serif;}"
    + ".lqfb-panel.open{display:flex;}"
    + ".lqfb-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#4f46e5;color:#fff;}"
    + ".lqfb-head b{font-size:14px;font-weight:600;}"
    + ".lqfb-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;}"
    + ".lqfb-body{flex:1;overflow-y:auto;padding:12px;background:#f7f7fb;display:flex;flex-direction:column;gap:8px;}"
    + ".lqfb-msg{max-width:85%;padding:8px 11px;border-radius:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}"
    + ".lqfb-a{align-self:flex-start;background:#eef2ff;color:#1e1b4b;border-bottom-left-radius:4px;}"
    + ".lqfb-u{align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:4px;}"
    + ".lqfb-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff;}"
    + ".lqfb-input{flex:1;border:1px solid #d1d5db;border-radius:10px;padding:9px 11px;font:14px inherit;resize:none;outline:none;}"
    + ".lqfb-send{border:none;border-radius:10px;padding:0 14px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer;}"
    + ".lqfb-send:disabled{opacity:.5;cursor:default;}"
    + ".lqfb-note{font-size:12px;color:#6b7280;text-align:center;padding:6px;}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "lqfb-btn";
  btn.type = "button";
  btn.textContent = "💬 感想を聞かせて";

  var panel = document.createElement("div");
  panel.className = "lqfb-panel";
  panel.innerHTML = ""
    + '<div class="lqfb-head"><b>かんたんインタビュー</b><button class="lqfb-close" type="button" aria-label="閉じる">×</button></div>'
    + '<div class="lqfb-body"></div>'
    + '<div class="lqfb-foot"><textarea class="lqfb-input" rows="1" placeholder="メッセージを入力…"></textarea><button class="lqfb-send" type="button">送信</button></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector(".lqfb-body");
  var input = panel.querySelector(".lqfb-input");
  var sendBtn = panel.querySelector(".lqfb-send");
  var closeBtn = panel.querySelector(".lqfb-close");

  function render(){
    body.innerHTML = "";
    messages.forEach(function(m){
      var el = document.createElement("div");
      el.className = "lqfb-msg " + (m.role === "user" ? "lqfb-u" : "lqfb-a");
      el.textContent = m.content;
      body.appendChild(el);
    });
    if (sending) {
      var t = document.createElement("div");
      t.className = "lqfb-msg lqfb-a";
      t.textContent = "…";
      body.appendChild(t);
    }
    if (done) {
      var n = document.createElement("div");
      n.className = "lqfb-note";
      n.textContent = "ご協力ありがとうございました 🙏";
      body.appendChild(n);
    }
    body.scrollTop = body.scrollHeight;
  }

  function setOpen(open){
    panel.className = "lqfb-panel" + (open ? " open" : "");
    btn.style.display = open ? "none" : "";
    if (open) { render(); input.focus(); }
  }

  function send(){
    var text = (input.value || "").trim();
    if (!text || sending || done) return;
    messages.push({ role: "user", content: text });
    input.value = "";
    sending = true;
    render();
    fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: messages, respondentId: respondentId() })
    })
      .then(function(r){ return r.json(); })
      .then(function(j){
        sending = false;
        if (j && j.reply) messages.push({ role: "assistant", content: j.reply });
        if (j && j.done) done = true;
        render();
      })
      .catch(function(){
        sending = false;
        messages.push({ role: "assistant", content: "通信エラーが発生しました。もう一度お試しください。" });
        render();
      });
  }

  btn.addEventListener("click", function(){ setOpen(true); });
  closeBtn.addEventListener("click", function(){ setOpen(false); });
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function(e){
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
})();`;
}
