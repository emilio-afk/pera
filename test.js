
      let currentMode = "pera"; // 'pera' | 'qpc'

      const DRAFT_KEY_PERA = "pera_draft_v1";
      const DRAFT_KEY_QPC = "qpc_draft_v1";
      const ITERATION_KEY = "pera_iteration_state_v1";
      const GAME_KEY = "pera_story_game_v1";
      const DEFAULT_DAILY_LIMIT = 12;
      const API_BASE_CANDIDATES = buildApiBaseCandidates();
      let ACTIVE_API_BASE = API_BASE_CANDIDATES[0] || "";
      let BACKEND_VERIFIED = false;
      let dailyLimit = DEFAULT_DAILY_LIMIT;
      let messageIterations = 0;
      let dailyUsageCount = 0;

      const latestRewrites = {};

      const DEFAULT_SETTINGS = {
        tone: "formal",
        formality: "medio",
        objective: "informar",
        audience: "",
        channel: "presentacion",
        length: "media",
        industry: "general",
        urgency: "media",
        argument_style: "balanceado",
        cta_type: "directa",
      };

      const SETTINGS_FIELD_MAP = {
        tone: "tone-select",
        formality: "formality-select",
        objective: "objective-select",
        audience: "audience-input",
        channel: "channel-select",
        length: "length-select",
        industry: "industry-select",
        urgency: "urgency-select",
        argument_style: "argument-style-select",
        cta_type: "cta-type-select",
      };

      const GUIDED_STEPS_PERA = [
        {
          id: "point",
          label: "Punto",
          inputId: "point-input",
          cardId: "step-point-card",
          stateId: "state-point",
          pillId: "step-pill-point",
          minChars: 24,
        },
        {
          id: "example",
          label: "Ejemplo",
          inputId: "example-input",
          cardId: "step-example-card",
          stateId: "state-example",
          pillId: "step-pill-example",
          minChars: 40,
        },
        {
          id: "reasons",
          label: "Razones",
          inputId: "reasons-input",
          cardId: "step-reasons-card",
          stateId: "state-reasons",
          pillId: "step-pill-reasons",
          minChars: 35,
        },
        {
          id: "action",
          label: "Accion",
          inputId: "action-input",
          cardId: "step-action-card",
          stateId: "state-action",
          pillId: "step-pill-action",
          minChars: 24,
        },
      ];

      const GUIDED_STEPS_QPC = [
        {
          id: "que",
          label: "Que",
          inputId: "que-input",
          cardId: "step-que-card",
          stateId: "state-que",
          pillId: "step-pill-que",
          minChars: 24,
        },
        {
          id: "porque",
          label: "Por que",
          inputId: "porque-input",
          cardId: "step-porque-card",
          stateId: "state-porque",
          pillId: "step-pill-porque",
          minChars: 24,
        },
        {
          id: "como",
          label: "Como",
          inputId: "como-input",
          cardId: "step-como-card",
          stateId: "state-como",
          pillId: "step-pill-como",
          minChars: 24,
        },
      ];

      const RANKS = [
        { minXP: 0, label: "Aprendiz" },
        { minXP: 60, label: "Narrador" },
        { minXP: 140, label: "Arquitecto" },
        { minXP: 240, label: "Estratega" },
        { minXP: 360, label: "Maestro" },
      ];

      const MISSIONS = [
        { id: "full_draft", label: "Completa todas las casillas", xp: 20 },
        {
          id: "audience_set",
          label: "Define una audiencia especifica",
          xp: 12,
        },
        {
          id: "first_analysis",
          label: "Realiza tu primer analisis IA",
          xp: 18,
        },
        { id: "clarity_80", label: "Consigue 80+ en claridad", xp: 25 },
        {
          id: "actionability_80",
          label: "Consigue 80+ en accionabilidad",
          xp: 25,
        },
        {
          id: "apply_two_rewrites",
          label: "Aplica 2 sugerencias de IA",
          xp: 20,
        },
        {
          id: "export_message",
          label: "Exporta el mensaje (TXT o PDF)",
          xp: 15,
        },
      ];

      let gameState = createDefaultGameState();

      // Switch Mode
      document
        .getElementById("nav-pera")
        .addEventListener("click", () => setMode("pera"));
      document
        .getElementById("nav-qpc")
        .addEventListener("click", () => setMode("qpc"));

      function setMode(mode) {
        currentMode = mode;
        document
          .getElementById("nav-pera")
          .classList.toggle("active", mode === "pera");
        document
          .getElementById("nav-qpc")
          .classList.toggle("active", mode === "qpc");

        document.getElementById("builder-pera").style.display =
          mode === "pera" ? "block" : "none";
        document.getElementById("builder-qpc").style.display =
          mode === "qpc" ? "block" : "none";

        document.getElementById("theory-pera").style.display =
          mode === "pera" ? "block" : "none";
        document.getElementById("theory-qpc").style.display =
          mode === "qpc" ? "block" : "none";

        const title = document.getElementById("main-title");
        const desc = document.getElementById("main-desc");
        if (mode === "pera") {
          title.textContent = "PERA";
          desc.textContent =
            "Domina el arte de comunicar con eficacia e inspiracion";
        } else {
          title.textContent = "Piramide QPC";
          desc.textContent =
            "Destila tu mensaje ejecutivo (Que, Por que, Como)";
        }

        resetAnalysisUI();
        loadDraft();
        updateGenerated();
        updateIterationUI();
      }

      function getActiveSteps() {
        return currentMode === "pera" ? GUIDED_STEPS_PERA : GUIDED_STEPS_QPC;
      }

      function getTodayKey() {
        return new Date().toISOString().slice(0, 10);
      }
      function clampToNonNegativeNumber(value) {
        return !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
      }
      function getStepTextLength(step) {
        const node = document.getElementById(step.inputId);
        return node ? node.value.trim().length : 0;
      }
      function isStepComplete(step) {
        return getStepTextLength(step) >= step.minChars;
      }
      function isGuidedFlowComplete() {
        return getActiveSteps().every((step) => isStepComplete(step));
      }

      function updateGuidedFlow() {
        const steps = getActiveSteps();
        const guideNode = document.getElementById(
          currentMode === "pera" ? "peraGuideStatus" : "qpcGuideStatus",
        );

        steps.forEach((step, index) => {
          const inputNode = document.getElementById(step.inputId);
          const cardNode = document.getElementById(step.cardId);
          const stateNode = document.getElementById(step.stateId);
          const pillNode = document.getElementById(step.pillId);

          const unlocked =
            index === 0 ? true : isStepComplete(steps[index - 1]);
          const done = isStepComplete(step);

          if (inputNode) {
            inputNode.disabled = !unlocked;
            inputNode.setAttribute("aria-disabled", String(!unlocked));
          }
          if (cardNode) {
            cardNode.classList.toggle("locked", !unlocked);
            cardNode.classList.toggle("complete", done);
          }
          if (stateNode) {
            stateNode.textContent = !unlocked
              ? "Bloqueado"
              : done
                ? "Listo"
                : "En progreso";
          }
          if (pillNode) {
            pillNode.classList.toggle("done", done);
            pillNode.classList.toggle("active", unlocked && !done);
          }
        });

        if (guideNode) {
          const firstPending = steps.find((step) => !isStepComplete(step));
          if (!firstPending) {
            guideNode.textContent =
              "Flujo completo. Ya puedes analizar con IA.";
          } else {
            const nextStepIndex =
              steps.findIndex((step) => step.id === firstPending.id) + 1;
            const unlockLabel =
              nextStepIndex < steps.length
                ? steps[nextStepIndex].label
                : "Analisis IA";
            guideNode.textContent = `Completa ${firstPending.label} (${firstPending.minChars}+ caracteres) para desbloquear ${unlockLabel}.`;
          }
        }
        updateIterationUI();
      }

      function createDefaultGameState() {
        return {
          xp: 0,
          completedMissions: {},
          badges: {},
          appliedSuggestions: 0,
          bestOverallScore: 0,
          eventNote: "Completa misiones para desbloquear logros.",
        };
      }

      function getRankByXP(xp) {
        let rank = RANKS[0];
        for (const r of RANKS) if (xp >= r.minXP) rank = r;
        return rank;
      }
      function getNextRank(currentXP) {
        for (const r of RANKS) if (r.minXP > currentXP) return r;
        return null;
      }
      function getCompletedMissionCount() {
        return MISSIONS.filter((m) => gameState.completedMissions[m.id]).length;
      }
      function saveGameState() {
        try {
          localStorage.setItem(GAME_KEY, JSON.stringify(gameState));
        } catch {}
      }
      function loadGameState() {
        try {
          const raw = localStorage.getItem(GAME_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            gameState = { ...createDefaultGameState(), ...parsed };
          }
        } catch {}
        updateGameUI();
      }

      function flashRankPill() {
        const rankNode = document.getElementById("playerRankPill");
        if (!rankNode) return;
        rankNode.classList.remove("flash-level");
        window.requestAnimationFrame(() =>
          rankNode.classList.add("flash-level"),
        );
      }

      function updateGameUI() {
        const rank = getRankByXP(gameState.xp);
        const nextRank = getNextRank(gameState.xp);
        const completed = getCompletedMissionCount();

        document.getElementById("playerRankPill").textContent =
          `Rango: ${rank.label}`;
        document.getElementById("playerXpPill").textContent =
          `XP: ${gameState.xp}`;
        document.getElementById("missionCountPill").textContent =
          `Misiones: ${completed}/${MISSIONS.length}`;
        document.getElementById("gameEventNote").textContent =
          gameState.eventNote;

        const xpFill = document.getElementById("xpFill");
        let progress = 100;
        if (nextRank) {
          const span = nextRank.minXP - rank.minXP;
          const comp = gameState.xp - rank.minXP;
          progress = span > 0 ? (comp / span) * 100 : 100;
        }
        xpFill.style.width = `${Math.max(4, Math.min(100, progress))}%`;

        document.getElementById("missionList").innerHTML = MISSIONS.map((m) => {
          const done = gameState.completedMissions[m.id];
          return `<div class="mission-item ${done ? "done" : ""}"><span>${done ? "Lista" : "Pendiente"}: ${m.label}</span><strong>${m.xp} XP</strong></div>`;
        }).join("");

        const badges = Object.values(gameState.badges || {});
        document.getElementById("badgeRow").innerHTML = badges.length
          ? badges
              .map((b) => `<span class="badge-chip">${escapeForHTML(b)}</span>`)
              .join("")
          : `<span class="badge-chip empty">Sin logros todavia</span>`;
      }

      function awardXP(amount, reason) {
        const points = clampToNonNegativeNumber(amount);
        if (!points) return;
        const rankBefore = getRankByXP(gameState.xp);
        gameState.xp += points;
        const rankAfter = getRankByXP(gameState.xp);
        if (rankAfter.label !== rankBefore.label) {
          gameState.eventNote = `Subiste de nivel: ${rankAfter.label} (+${points} XP).`;
          flashRankPill();
        } else {
          gameState.eventNote = `+${points} XP: ${reason}`;
        }
        saveGameState();
        updateGameUI();
      }

      function completeMission(id, reasonOverride = "") {
        const m = MISSIONS.find((item) => item.id === id);
        if (!m || gameState.completedMissions[id]) return false;
        gameState.completedMissions[id] = true;
        awardXP(m.xp, reasonOverride || m.label);
        gameState.eventNote = `Mision completada: ${m.label}`;
        saveGameState();
        updateGameUI();
        return true;
      }
      function unlockBadge(id, label) {
        if (!id || !label || gameState.badges[id]) return false;
        gameState.badges[id] = label;
        gameState.eventNote = `Logro desbloqueado: ${label}`;
        saveGameState();
        updateGameUI();
        return true;
      }

      function evaluateDraftMissions() {
        const steps = getActiveSteps();
        if (isGuidedFlowComplete()) completeMission("full_draft");
        if (document.getElementById("audience-input").value.trim())
          completeMission("audience_set");
      }

      function evaluateAnalysisMissions(analysis) {
        const scores = analysis?.scores || {};
        completeMission("first_analysis");
        if (Number(scores.clarity) >= 80) completeMission("clarity_80");
        if (Number(scores.actionability) >= 80)
          completeMission("actionability_80");

        const avg =
          (Number(scores.clarity || 0) +
            Number(scores.coherence || 0) +
            Number(scores.persuasion || 0) +
            Number(scores.actionability || 0)) /
          4;
        if (avg > gameState.bestOverallScore) {
          const delta = avg - gameState.bestOverallScore;
          gameState.bestOverallScore = avg;
          if (delta >= 5)
            awardXP(10, `mejora de ${Math.round(delta)} puntos promedio`);
        }
        if (avg >= 85) unlockBadge("gold_script", "Guion de Oro");
        if (getCompletedMissionCount() === MISSIONS.length)
          unlockBadge("mission_master", "Master de Misiones");
        saveGameState();
        updateGameUI();
      }

      function saveIterationState() {
        try {
          localStorage.setItem(
            ITERATION_KEY,
            JSON.stringify({
              date: getTodayKey(),
              messageIterations,
              dailyUsageCount,
            }),
          );
        } catch {}
      }
      function loadIterationState() {
        try {
          const raw = localStorage.getItem(ITERATION_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.date === getTodayKey()) {
              messageIterations = clampToNonNegativeNumber(
                parsed.messageIterations,
              );
              dailyUsageCount = clampToNonNegativeNumber(
                parsed.dailyUsageCount,
              );
            } else {
              messageIterations = 0;
              dailyUsageCount = 0;
              saveIterationState();
            }
          }
        } catch {}
        updateIterationUI();
      }

      function updateIterationUI() {
        document.getElementById("messageIterationCounter").textContent =
          `Iteraciones del mensaje: ${messageIterations}`;
        const limitReached = dailyUsageCount >= dailyLimit;
        document.getElementById("dailyUsageCounter").textContent =
          `Uso IA hoy: ${dailyUsageCount}/${dailyLimit}`;
        document
          .getElementById("dailyUsageCounter")
          .classList.toggle("limit", limitReached);

        const analyzeButton = document.getElementById("analyzeBtn");
        const flowReady = isGuidedFlowComplete();
        if (analyzeButton.textContent !== "Analizando...") {
          analyzeButton.disabled = limitReached || !flowReady;
          if (limitReached)
            analyzeButton.textContent = "Limite diario alcanzado";
          else if (!flowReady)
            analyzeButton.textContent = "Completa pasos para analizar";
          else analyzeButton.textContent = "Analizar con IA";
        }
      }

      function buildApiBaseCandidates() {
        const { protocol, hostname, port } = window.location;
        if (protocol === "file:") return ["http://127.0.0.1:8787"];
        const candidates = [""];
        if (
          new Set(["localhost", "127.0.0.1", "::1"]).has(hostname) &&
          port &&
          port !== "8787"
        ) {
          candidates.push("http://127.0.0.1:8787");
        }
        return [...new Set(candidates)];
      }
      async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...options, signal: controller.signal });
        } finally {
          window.clearTimeout(timer);
        }
      }

      function escapeForHTML(value) {
        if (typeof value !== "string") return "";
        return value
          .replace(/&/g, "&")
          .replace(/</g, "<")
          .replace(/>/g, ">")
          .replace(/\r?\n/g, "<br>");
      }

      function getScriptFromInputs() {
        return getActiveSteps()
          .map((step) => document.getElementById(step.inputId).value.trim())
          .filter(Boolean)
          .join("\n\n");
      }

      function getSettingsFromForm() {
        return {
          tone: document.getElementById("tone-select").value,
          formality: document.getElementById("formality-select").value,
          objective: document.getElementById("objective-select").value,
          audience: document.getElementById("audience-input").value.trim(),
          channel: document.getElementById("channel-select").value,
          length: document.getElementById("length-select").value,
          industry: document.getElementById("industry-select").value,
          urgency: document.getElementById("urgency-select").value,
          argument_style: document.getElementById("argument-style-select")
            .value,
          cta_type: document.getElementById("cta-type-select").value,
        };
      }
      function applySettingsToForm(settings = {}) {
        const next = { ...DEFAULT_SETTINGS, ...settings };
        Object.entries(SETTINGS_FIELD_MAP).forEach(([key, id]) => {
          const node = document.getElementById(id);
          if (node) node.value = next[key] ?? DEFAULT_SETTINGS[key];
        });
      }

      function clearRewrites() {
        Object.keys(latestRewrites).forEach((k) => delete latestRewrites[k]);
      }
      function resetAnalysisUI() {
        clearRewrites();
        document.getElementById("aiResult").innerHTML = "";
        document.getElementById("aiPlaceholder").style.display = "block";
      }

      function getPayload() {
        const sections = {};
        getActiveSteps().forEach((step) => {
          sections[step.id] = document
            .getElementById(step.inputId)
            .value.trim();
        });
        return { sections, settings: getSettingsFromForm() };
      }

      function updateGenerated() {
        const script = getScriptFromInputs();
        document.getElementById("generated-content").innerHTML = script
          ? escapeForHTML(script)
          : "Escribe arriba para ver tu guion aqui.";
        updateGuidedFlow();
      }

      function saveDraft() {
        try {
          const key = currentMode === "pera" ? DRAFT_KEY_PERA : DRAFT_KEY_QPC;
          localStorage.setItem(key, JSON.stringify(getPayload()));
          const node = document.getElementById("saveStatus");
          node.classList.add("show");
          window.setTimeout(() => node.classList.remove("show"), 800);
        } catch {}
      }

      function loadDraft() {
        const key = currentMode === "pera" ? DRAFT_KEY_PERA : DRAFT_KEY_QPC;
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const draft = JSON.parse(raw);
            if (draft?.sections) {
              getActiveSteps().forEach((step) => {
                const node = document.getElementById(step.inputId);
                if (node) node.value = draft.sections[step.id] || "";
              });
            }
            applySettingsToForm(draft?.settings || DEFAULT_SETTINGS);
          } else {
            getActiveSteps().forEach((step) => {
              const node = document.getElementById(step.inputId);
              if (node) node.value = "";
            });
            applySettingsToForm(DEFAULT_SETTINGS);
          }
          evaluateDraftMissions();
        } catch {}
        updateGenerated();
      }

      async function checkBackendHealth() {
        for (const base of API_BASE_CANDIDATES) {
          try {
            const response = await fetchWithTimeout(
              `${base}/api/health`,
              { method: "GET" },
              4000,
            );
            const data = await response.json();
            if (response.ok) {
              ACTIVE_API_BASE = base;
              if (data?.rateLimitPerDay)
                dailyLimit = Math.floor(Number(data.rateLimitPerDay));
              BACKEND_VERIFIED = data?.openaiConfigured;
              updateIterationUI();
              return BACKEND_VERIFIED;
            }
          } catch {}
        }
        BACKEND_VERIFIED = false;
        return false;
      }

      function renderAnalysis(analysis) {
        document.getElementById("aiPlaceholder").style.display = "none";

        const sectionFeedback = analysis?.section_feedback || {};
        let feedbackHTML = "";

        getActiveSteps().forEach((step) => {
          const fb = sectionFeedback[step.id] || {};
          latestRewrites[step.id] = fb.rewrite || "";
          feedbackHTML += `
            <article class="feedback-card">
              <h4>${step.label}</h4>
              <p><strong>Diagnostico:</strong> ${escapeForHTML(fb.diagnosis)}</p>
              <p><strong>Sugerencia:</strong> ${escapeForHTML(fb.suggestion)}</p>
              <div class="feedback-rewrite">${escapeForHTML(fb.rewrite)}</div>
              <button class="mini-btn apply-btn" data-field="${step.id}" type="button">Aplicar sugerencia</button>
            </article>
          `;
        });

        const score = analysis?.scores || {};
        const alternatives = Array.isArray(analysis?.alternatives)
          ? analysis.alternatives
          : [];

        document.getElementById("aiResult").innerHTML = `
          <p><strong>Resumen:</strong> ${escapeForHTML(analysis?.summary)}</p>
          <div class="score-grid">
            <div class="score-item"><strong>Claridad</strong>${Number(score.clarity || 0)}/100</div>
            <div class="score-item"><strong>Coherencia</strong>${Number(score.coherence || 0)}/100</div>
            <div class="score-item"><strong>Persuasion</strong>${Number(score.persuasion || 0)}/100</div>
            <div class="score-item"><strong>Accionabilidad</strong>${Number(score.actionability || 0)}/100</div>
          </div>
          <div class="feedback-grid">${feedbackHTML}</div>
          <h4>Guion mejorado completo</h4>
          <p>${escapeForHTML(analysis?.full_rewrite)}</p>
          <div class="alternatives">
            <h4>Alternativas</h4>
            <ol>${alternatives
              .slice(0, 3)
              .map(
                (a) =>
                  `<li><strong>${escapeForHTML(a.label)}</strong>: ${escapeForHTML(a.text)}</li>`,
              )
              .join("")}</ol>
          </div>
        `;
        awardXP(4, "iteracion analizada");
        evaluateAnalysisMissions(analysis);
      }

      async function analyzeWithAI() {
        if (!isGuidedFlowComplete() || dailyUsageCount >= dailyLimit) return;

        const button = document.getElementById("analyzeBtn");
        button.disabled = true;
        button.textContent = "Analizando...";

        try {
          const ok = await checkBackendHealth();
          if (!ok)
            throw new Error("Backend IA no disponible o mal configurado.");

          messageIterations++;
          dailyUsageCount++;
          saveIterationState();
          updateIterationUI();

          const endpoint =
            currentMode === "pera" ? "/api/pera/analyze" : "/api/qpc/analyze";
          const res = await fetchWithTimeout(`${ACTIVE_API_BASE}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(getPayload()),
          });

          const raw = await res.text();
          let data = {};
          try {
            data = JSON.parse(raw);
          } catch {}
          if (data?.usage) {
            dailyUsageCount = Number(data.usage.count) || dailyUsageCount;
            saveIterationState();
            updateIterationUI();
          }
          if (!res.ok) throw new Error(data?.error || "Error al analizar");

          renderAnalysis(data.analysis);
        } catch (error) {
          alert(error.message || "Error");
        } finally {
          button.disabled = false;
          updateIterationUI();
        }
      }

      document.querySelectorAll("textarea, select, input").forEach((node) => {
        node.addEventListener("input", () => {
          updateGenerated();
          saveDraft();
          evaluateDraftMissions();
        });
      });

      document
        .getElementById("analyzeBtn")
        .addEventListener("click", analyzeWithAI);

      document.getElementById("aiResult").addEventListener("click", (e) => {
        const btn = e.target.closest(".apply-btn");
        if (!btn) return;
        const field = btn.dataset.field;
        const step = getActiveSteps().find((s) => s.id === field);
        if (!step) return;

        const rewrite = latestRewrites[field];
        const inputNode = document.getElementById(step.inputId);
        if (inputNode.value.trim() !== rewrite.trim()) {
          inputNode.value = rewrite;
          gameState.appliedSuggestions++;
          awardXP(6, "sugerencia aplicada");
          if (gameState.appliedSuggestions >= 2)
            completeMission("apply_two_rewrites");
          saveGameState();
          updateGenerated();
          saveDraft();
          evaluateDraftMissions();
        }
      });

      document.getElementById("clearBtn").addEventListener("click", () => {
        if (!confirm("Se limpiara todo. Seguro?")) return;
        getActiveSteps().forEach(
          (step) => (document.getElementById(step.inputId).value = ""),
        );
        applySettingsToForm(DEFAULT_SETTINGS);
        resetAnalysisUI();
        messageIterations = 0;
        saveIterationState();
        updateIterationUI();
        try {
          localStorage.removeItem(
            currentMode === "pera" ? DRAFT_KEY_PERA : DRAFT_KEY_QPC,
          );
        } catch {}
        updateGenerated();
        evaluateDraftMissions();
      });

      document.getElementById("downloadBtn").addEventListener("click", () => {
        const blob = new Blob([getScriptFromInputs()], {
          type: "text/plain;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mensaje-${currentMode}.txt`;
        a.click();
        completeMission("export_message");
      });

      document.getElementById("pdfBtn").addEventListener("click", () => {
        const win = window.open("", "_blank");
        if (!win) return;
        let stepsHTML = getActiveSteps()
          .map(
            (step) =>
              `<div style="margin-bottom:10px"><strong>${step.label}:</strong> ${escapeForHTML(document.getElementById(step.inputId).value)}</div>`,
          )
          .join("");

        win.document.write(
          `<html><head><title>Mensaje ${currentMode.toUpperCase()}</title></head><body style="font-family:sans-serif;padding:40px;"><h1>Mensaje ${currentMode.toUpperCase()}</h1>${stepsHTML}<h2>Guion completo</h2><p>${escapeForHTML(getScriptFromInputs())}</p><script>window.print();<\/script></body></html>`,
        );
        win.document.close();
        completeMission("export_message");
      });

      document.getElementById("resetGameBtn").addEventListener("click", () => {
        if (!confirm("Reiniciar progreso?")) return;
        gameState = createDefaultGameState();
        saveGameState();
        updateGameUI();
      });

      // Init
      loadGameState();
      loadIterationState();
      setMode("pera"); // This loads the draft and updates UI
      checkBackendHealth();
    