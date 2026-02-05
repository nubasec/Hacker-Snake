(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const bestEl  = document.getElementById("best");
  const vpnBadge = document.getElementById("vpnBadge");

  const levelText = document.getElementById("levelText");
  const levelNeed = document.getElementById("levelNeed");
  const levelFill = document.getElementById("levelFill");

  const btnStart = document.getElementById("btnStart");
  const btnPause = document.getElementById("btnPause");
  const btnRestart = document.getElementById("btnRestart");
  const btnSound = document.getElementById("btnSound");

  const skinSel = document.getElementById("skin");
  const foodsSel = document.getElementById("foods");

  const CELL = 30;
  const COLS = canvas.width / CELL;
  const ROWS = canvas.height / CELL;

  let HACKER_HEAD = skinSel.value;
  const HACKER_BODY = "💾";
  const VPN = "🛡️";
  const FIREWALL = "🧱";

  const LEVEL_STEP_POINTS = 100;
  let FOODS = parseFoods(foodsSel.value);

  let snake, dir, nextDir, food, foodEmoji;
  let score = 0;
  let best = Number(localStorage.getItem("hackerSnakeBestMaze") || 0);
  bestEl.textContent = best;

  let running = false;
  let paused = false;

  let lastTick = 0;
  let tickMsBase = 130;
  let tickMs = tickMsBase;

  let level = 1;

  let firewalls = [];
  let vpn = null;
  let vpnActiveUntil = 0;

  // --- Sound
  let audioCtx = null;
  let soundOn = (localStorage.getItem("hackerSnakeSound") ?? "on") === "on";
  updateSoundBtn();

  function ensureAudio(){
    if (!soundOn) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
  }

  function beep(freq = 440, duration = 0.07, type = "sine", gain = 0.06){
    if (!soundOn) return;
    ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const SFX = {
    eat(){ beep(660, 0.07, "triangle", 0.07); beep(880, 0.06, "triangle", 0.06); },
    vpn(){ beep(520, 0.09, "sine", 0.07); beep(780, 0.10, "sine", 0.06); },
    level(){ beep(392, 0.08, "square", 0.05); beep(523, 0.08, "square", 0.05); beep(659, 0.10, "square", 0.05); },
    over(){ beep(220, 0.16, "sawtooth", 0.07); beep(196, 0.18, "sawtooth", 0.07); },
    click(){ beep(440, 0.05, "sine", 0.04); }
  };

  btnSound.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem("hackerSnakeSound", soundOn ? "on" : "off");
    updateSoundBtn();
    SFX.click();
  });

  function updateSoundBtn(){
    btnSound.textContent = soundOn ? "🔊" : "🔇";
    btnSound.title = soundOn ? "Sonido: ON" : "Sonido: OFF";
  }

  // --- Utils
  function randInt(n){ return Math.floor(Math.random() * n); }
  function now(){ return performance.now(); }

  function parseFoods(v){
    return v.split(",").map(s => s.trim()).filter(Boolean);
  }
  function samePos(a,b){ return a.x === b.x && a.y === b.y; }
  function isOpposite(a, b){ return a.x === -b.x && a.y === -b.y; }

  function setDir(newDir){
    if(!isOpposite(newDir, dir)) nextDir = newDir;
  }

  function inSafeZone(p){
    const dx = Math.abs(p.x - 10);
    const dy = Math.abs(p.y - 10);
    return (dx + dy) <= 3;
  }

  function pickEmptyCell(){
    while(true){
      const pos = { x: randInt(COLS), y: randInt(ROWS) };
      const occupied =
        snake.some(s => samePos(s,pos)) ||
        firewalls.some(w => samePos(w,pos)) ||
        (food && samePos(food,pos)) ||
        (vpn && samePos(vpn,pos)) ||
        inSafeZone(pos);
      if(!occupied) return pos;
    }
  }

  function placeFood(){
    food = pickEmptyCell();
    foodEmoji = FOODS[randInt(FOODS.length)];
  }

  function maybePlaceVPN(){
    if (vpn) return;
    if (Math.random() < 0.22) vpn = pickEmptyCell();
  }

  // --- Maze
  function rebuildMazeForLevel(){
    const segmentCount = Math.min(14, 4 + Math.floor(level * 1.2));
    const minLen = 3;
    const maxLen = Math.min(8, 4 + Math.floor(level / 2));

    const key = (x,y)=>`${x},${y}`;
    const walls = new Set();

    const addCell = (x,y) => {
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
      const p = {x,y};
      if (inSafeZone(p)) return false;
      walls.add(key(x,y));
      return true;
    };

    for(let s=0; s<segmentCount; s++){
      let start = { x: randInt(COLS), y: randInt(ROWS) };
      if (inSafeZone(start)) { s--; continue; }

      const horizontal = Math.random() < 0.5;
      const dirr = Math.random() < 0.5 ? -1 : 1;
      const len = minLen + randInt(Math.max(1, (maxLen - minLen + 1)));

      if (walls.size > 0 && Math.random() < 0.45){
        const arr = Array.from(walls);
        const [wx, wy] = arr[randInt(arr.length)].split(",").map(Number);
        start = { x: wx, y: wy };
      }

      for(let i=0;i<len;i++){
        const x = start.x + (horizontal ? i*dirr : 0);
        const y = start.y + (horizontal ? 0 : i*dirr);
        addCell(x,y);
      }

      if (Math.random() < 0.35){
        const bx = start.x + (horizontal ? Math.floor(len/2)*dirr : 0);
        const by = start.y + (horizontal ? 0 : Math.floor(len/2)*dirr);
        const branchHorizontal = !horizontal;
        const bdir = Math.random() < 0.5 ? -1 : 1;
        const blen = 2 + randInt(4);
        for(let j=0;j<blen;j++){
          const x = bx + (branchHorizontal ? j*bdir : 0);
          const y = by + (branchHorizontal ? 0 : j*bdir);
          addCell(x,y);
        }
      }
    }

    firewalls = Array.from(walls).map(k => {
      const [x,y] = k.split(",").map(Number);
      return {x,y};
    });

    const cap = Math.min(70, 20 + level * 6);
    if (firewalls.length > cap) firewalls = firewalls.slice(0, cap);
  }

  function updateDifficulty(){
    const newLevel = 1 + Math.floor(score / LEVEL_STEP_POINTS);

    if(newLevel !== level){
      level = newLevel;
      levelEl.textContent = level;
      tickMs = Math.max(55, tickMsBase - (level - 1) * 6);

      rebuildMazeForLevel();
      placeFood();
      vpn = null;
      maybePlaceVPN();
      SFX.level();
    }

    updateLevelUI();
  }

  function updateLevelUI(){
    const base = (level - 1) * LEVEL_STEP_POINTS;
    const into = score - base;
    const pct = Math.max(0, Math.min(100, (into / LEVEL_STEP_POINTS) * 100));

    levelText.textContent = `Nivel ${level}`;
    levelNeed.textContent = `${into}/${LEVEL_STEP_POINTS}`;
    levelFill.style.width = `${pct}%`;
  }

  function updateVPNBadge(ts = now()){
    const active = ts < vpnActiveUntil;
    vpnBadge.innerHTML = active
      ? `VPN: <strong>ON</strong> · <small>${Math.ceil((vpnActiveUntil - ts)/1000)}s</small>`
      : `VPN: <strong>OFF</strong>`;
  }

  function reset(){
    HACKER_HEAD = skinSel.value;
    FOODS = parseFoods(foodsSel.value);

    snake = [
      { x: 10, y: 10 },
      { x: 9,  y: 10 },
      { x: 8,  y: 10 },
    ];

    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };

    score = 0;
    scoreEl.textContent = score;

    level = 1;
    levelEl.textContent = level;

    tickMs = tickMsBase;

    firewalls = [];
    vpn = null;
    vpnActiveUntil = 0;

    rebuildMazeForLevel();
    placeFood();
    maybePlaceVPN();

    paused = false;
    updateVPNBadge();
    updateLevelUI();
    draw(false, true);
  }

  function start(){
    ensureAudio();
    reset();
    running = true;
    paused = false;

    btnStart.disabled = true;
    btnPause.disabled = false;
    btnRestart.disabled = false;
    btnPause.textContent = "Pausa";

    lastTick = 0;
    requestAnimationFrame(loop);
    SFX.click();
  }

  function gameOver(){
    running = false;

    btnStart.disabled = false;
    btnPause.disabled = true;
    btnRestart.disabled = true;

    if(score > best){
      best = score;
      localStorage.setItem("hackerSnakeBestMaze", String(best));
      bestEl.textContent = best;
    }

    SFX.over();
    draw(true, false);
  }

  function togglePause(){
    if(!running) return;
    paused = !paused;
    btnPause.textContent = paused ? "Reanudar" : "Pausa";
    draw(false, false);
    SFX.click();
  }

  function restartInPlace(){
    if(!running) return;
    reset();
    SFX.click();
  }

  function step(ts){
    dir = nextDir;

    const head = snake[0];
    let newHead = { x: head.x + dir.x, y: head.y + dir.y };

    const vpnActive = ts < vpnActiveUntil;

    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS){
      if (vpnActive) {
        newHead.x = (newHead.x + COLS) % COLS;
        newHead.y = (newHead.y + ROWS) % ROWS;
      } else {
        return gameOver();
      }
    }

    if (snake.some((s, i) => i !== 0 && samePos(s,newHead))) return gameOver();
    if (firewalls.some(w => samePos(w,newHead))) return gameOver();

    snake.unshift(newHead);

    if (samePos(newHead, food)){
      score += 10;
      scoreEl.textContent = score;

      SFX.eat();
      maybePlaceVPN();
      placeFood();
      updateDifficulty();
    } else if (vpn && samePos(newHead, vpn)){
      vpnActiveUntil = ts + 6000;
      vpn = null;
      SFX.vpn();
    } else {
      snake.pop();
    }

    updateVPNBadge(ts);
  }

  function draw(gameOverFlag, initial = false){
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const w of firewalls){
      drawCellGlow(w.x, w.y, "rgba(255,77,109,.13)");
      drawEmoji(FIREWALL, w.x * CELL + CELL/2, w.y * CELL + CELL/2, 22);
    }

    drawEmoji(foodEmoji, food.x * CELL + CELL/2, food.y * CELL + CELL/2, 24);

    if (vpn){
      drawCellGlow(vpn.x, vpn.y, "rgba(255,255,255,.12)");
      drawEmoji(VPN, vpn.x * CELL + CELL/2, vpn.y * CELL + CELL/2, 22);
    }

    for(let i = snake.length - 1; i >= 0; i--){
      const s = snake[i];
      drawCellGlow(s.x, s.y, i === 0 ? "rgba(124,219,124,.18)" : "rgba(124,219,124,.12)");
      drawEmoji(i === 0 ? HACKER_HEAD : HACKER_BODY,
        s.x * CELL + CELL/2, s.y * CELL + CELL/2,
        i === 0 ? 22 : 18
      );
    }

    if (!running || paused || gameOverFlag || initial){
      if (gameOverFlag) overlay("💥 Game Over", "Pulsa Jugar para intentar de nuevo");
      else if (paused) overlay("⏸ Pausa", "Pulsa Espacio para continuar");
      else overlay("🕹️ Listo", "Pulsa Jugar para empezar");
    }
  }

  function drawCellGlow(cx, cy, fill){
    const x = cx * CELL;
    const y = cy * CELL;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.restore();
  }

  function overlay(title, subtitle){
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.52)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = "700 44px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 18);

    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 26);
    ctx.restore();
  }

  function drawEmoji(emoji, cx, cy, sizePx){
    ctx.save();
    ctx.font = `${sizePx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, cx, cy + 1);
    ctx.restore();
  }

  function loop(ts){
    if(!running) return;

    if(!paused){
      if(!lastTick) lastTick = ts;
      const elapsed = ts - lastTick;
      if(elapsed >= tickMs){
        lastTick = ts;
        step(ts);
      }
      draw(false, false);
    } else {
      draw(false, false);
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();

    if (k === " "){ e.preventDefault(); togglePause(); return; }
    if (k === "r"){ e.preventDefault(); running ? restartInPlace() : start(); return; }

    if (k === "arrowup" || k === "w") setDir({ x: 0, y: -1 });
    if (k === "arrowdown" || k === "s") setDir({ x: 0, y: 1 });
    if (k === "arrowleft" || k === "a") setDir({ x: -1, y: 0 });
    if (k === "arrowright" || k === "d") setDir({ x: 1, y: 0 });
  });

  btnStart.addEventListener("click", start);
  btnPause.addEventListener("click", togglePause);
  btnRestart.addEventListener("click", restartInPlace);

  skinSel.addEventListener("change", () => {
    HACKER_HEAD = skinSel.value;
    if (!running) reset();
    else draw(false, false);
  });

  foodsSel.addEventListener("change", () => {
    FOODS = parseFoods(foodsSel.value);
    if (!running) reset();
  });

  document.querySelectorAll(".pad").forEach(btn => {
    btn.addEventListener("click", () => {
      ensureAudio();
      const d = btn.dataset.dir;
      if (d === "up") setDir({x:0,y:-1});
      if (d === "down") setDir({x:0,y:1});
      if (d === "left") setDir({x:-1,y:0});
      if (d === "right") setDir({x:1,y:0});
    });
  });

  let touchStart = null;
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    canvas.setPointerCapture(e.pointerId);
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    if(!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 18) return;

    if (ax > ay) setDir(dx > 0 ? {x:1,y:0} : {x:-1,y:0});
    else setDir(dy > 0 ? {x:0,y:1} : {x:0,y:-1});
  });

  reset();
})();
