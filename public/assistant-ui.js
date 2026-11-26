export class AssistantPanel {
  constructor({ api, escape, repaint, navigate }) {
    this.api = api;
    this.e = escape;
    this.repaint = repaint;
    this.navigate = navigate;
    this.reset();
  }
  reset() {
    this.generation = (this.generation || 0) + 1;
    this.messages = [];
    this.draft = "";
    this.error = "";
    this.pending = false;
    this.status = null;
    this.loading = false;
  }
  prompts(role) {
    return role === "salesman"
      ? ["Show my order status", "Which of my orders have shortages?"]
      : role === "production"
        ? [
            "How much flour is left?",
            "Explain the latest production variance",
            "What is the cost per packet?",
            "Show current stock",
          ]
        : [
            "How much flour is left?",
            "What is the cost per packet?",
            "Who still owes us money?",
            "Which orders have a stock shortage?",
          ];
  }
  view(role) {
    const e = this.e,
      mode = this.status?.mode;
    return `<section id="assistant-panel"><div class="heading"><div><div class="eyebrow">Your factory, explained</div><h1>Ask your factory.</h1><p class="subtitle">Answers grounded in the records you can access.</p></div><span class="badge ${mode === "ai" && this.status.ready !== false ? "good" : ""}">${mode === "ai" ? (this.status.provider === "ollama" ? (this.status.ready === false ? "Ollama · setup needed" : "Local AI · Ollama") : "AI enabled") : mode === "lookup" ? "Data lookup mode" : "Checking connection"}</span></div><div class="assistant-layout"><section class="panel assistant-chat"><div class="panelhead"><div class="assistant-title"><span class="assistant-symbol" aria-hidden="true">✦</span><div><h2>My Order assistant</h2><p>Stock · production · orders · payments</p></div></div><button class="linkbutton" data-chat-clear ${this.pending ? "disabled" : ""}>New chat</button></div><div id="assistant-messages" class="assistant-messages" role="log" aria-live="polite" aria-label="Factory assistant conversation">${
      this.messages.length
        ? this.messages
            .map(
              (m) =>
                `<article class="chat-message ${m.role}"><div class="chat-speaker">${m.role === "user" ? "You" : "My Order assistant"}</div><div class="chat-text">${e(m.content)}</div>${m.sources?.length ? `<div class="chat-sources"><span>Source records</span>${m.sources.map((s) => `<button data-chat-source="${e(s.page)}" class="source-chip">${e(s.label)}</button>`).join("")}</div>` : ""}${m.asOf ? `<div class="chat-time">${m.answerKind === "verified-records" ? "Verified record answer · Ollama connected" : m.mode === "ai" ? "AI answer" : "Built-in data lookup"} · snapshot ${e(new Date(m.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }))}</div>` : ""}</article>`,
            )
            .join("")
        : `<div class="assistant-welcome"><span class="assistant-symbol large" aria-hidden="true">✦</span><h2>What would you like to know?</h2><p>Start with a question about your working day.</p><div class="assistant-prompts">${this.prompts(
            role,
          )
            .map((p, i) => `<button data-chat-prompt="${i}">${e(p)}</button>`)
            .join("")}</div></div>`
    }${this.pending ? '<div class="assistant-thinking" role="status">Reading your current factory records…</div>' : ""}</div><div class="assistant-composer">${this.error ? `<div class="error" role="alert">${e(this.error)}</div>` : ""}<form id="assistant-form"><label class="sr-only" for="assistant-question">Ask a question about factory data</label><textarea id="assistant-question" name="question" rows="2" maxlength="2000" placeholder="Ask about stock, costs, orders, or payments…" required ${this.pending ? "disabled" : ""}>${e(this.draft)}</textarea><button class="btn" ${this.pending ? "disabled" : ""}>${this.pending ? "Working…" : "Ask"}</button></form><p>${mode === "ai" ? "AI answers can be mistaken. Check the linked records before making a decision." : "Built-in lookup works now. An administrator can connect AI for flexible questions and follow-ups."}</p></div></section><aside class="assistant-info"><section class="panel"><div class="panelbody"><div class="eyebrow">Connected to your work</div><h3>Fresh facts with every question</h3><p>Stock balances, costs and totals come from the same database as the rest of My Order.</p><hr><h3>Your role sets the scope</h3><p>${role === "salesman" ? "Your assigned customers and your own orders. Factory costing and customer payments stay with the billing team." : role === "production" ? "Inventory, recipes and production costs. Customer invoices and collections stay with the billing team." : "Inventory, production, order status and customer receivables. Source buttons take you back to the relevant records."}</p><hr><h3>Read-only answers</h3><p>Use the regular forms to approve, dispatch or record payments. The assistant cannot change transactions.</p></div></section><div class="assistant-config">${mode === "ai" ? (this.status.provider === "ollama" ? `Local AI uses ${e(this.status.model)} through Ollama on the app server. No API key is needed. Questions and authorized factory records stay on that machine. Ollama must be running with the model downloaded.` : `AI mode uses ${e(this.status.model)}. Questions and a limited summary of your authorized factory records are sent to OpenAI.`) : mode === "lookup" ? "AI is not configured. This mode uses fixed data queries on your server and sends nothing to an AI service." : "Checking whether AI is configured on the server."}<br><br>This chat stays in this browser tab and clears when you sign out. Historical analysis is available through Reports.</div></aside></div></section>`;
  }
  async loadStatus() {
    if (this.status || this.loading) return;
    const generation = this.generation;
    this.loading = true;
    try {
      const status = await this.api("assistant/status");
      if (generation === this.generation) {
        this.status = status;
        if (status.issue) this.error = status.issue;
        this.repaint();
      }
    } catch {
      if (generation === this.generation) {
        this.error =
          "Could not connect to the assistant. Check that the app server is running.";
        this.status = { mode: "unavailable" };
        this.repaint();
      }
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  bind(role) {
    const root = document.querySelector("#assistant-panel");
    if (!root) return;
    this.loadStatus();
    const field = root.querySelector("#assistant-question");
    field.oninput = () => (this.draft = field.value);
    root.querySelector("#assistant-form").onsubmit = (event) => {
      event.preventDefault();
      this.send(field.value);
    };
    root
      .querySelectorAll("[data-chat-prompt]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            this.send(this.prompts(role)[Number(b.dataset.chatPrompt)])),
      );
    root
      .querySelectorAll("[data-chat-source]")
      .forEach((b) => (b.onclick = () => this.navigate(b.dataset.chatSource)));
    root.querySelector("[data-chat-clear]").onclick = () => {
      this.reset();
      this.repaint();
    };
    const log = root.querySelector("#assistant-messages");
    log.scrollTop = log.scrollHeight;
  }
  async send(question) {
    if (this.pending || !question?.trim()) return;
    question = question.trim();
    if (question.length > 2000) {
      this.error = "Keep your question under 2,000 characters.";
      this.repaint();
      return;
    }
    const generation = this.generation,
      history = this.messages
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));
    this.pending = true;
    this.error = "";
    this.draft = "";
    this.messages.push({ role: "user", content: question });
    this.repaint();
    try {
      const result = await this.api("assistant", {
        message: question,
        history,
      });
      if (generation !== this.generation) return;
      this.messages.push({
        role: "assistant",
        content: result.answer,
        sources: result.sources,
        asOf: result.asOf,
        mode: result.mode,
        answerKind: result.answerKind,
      });
      this.messages = this.messages.slice(-20);
      this.status = {
        mode: result.mode,
        model: result.model,
        provider: result.provider,
      };
    } catch (error) {
      if (generation !== this.generation) return;
      this.messages.pop();
      this.error = error.message;
      this.draft = question;
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.repaint();
        document.querySelector("#assistant-question")?.focus();
      }
    }
  }
}
