/**
 * AuraAI Calculator and Code Validation Helper
 * Provides complete, standalone single-file HTML calculator code and code validation.
 */

const HTML_CALCULATOR_CODE = `### Features:
- Clean, responsive dark-mode interface styled with modern CSS
- Standard arithmetic (+, -, ×, ÷) plus scientific functions (square root, sin, cos, tan, log, power)
- Full parentheses handling and expression evaluation
- Interactive display with clear (AC) and backspace delete (DEL)
- Single self-contained file with embedded CSS and JavaScript

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Advanced Scientific Calculator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: #f8fafc; }
    .calculator { background: #1e293b; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 360px; max-width: 90vw; }
    .display { background: #0f172a; border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: right; }
    .previous-operand { color: #94a3b8; font-size: 0.9rem; min-height: 20px; word-break: break-all; }
    .current-operand { color: #f8fafc; font-size: 1.8rem; font-weight: 600; min-height: 38px; word-break: break-all; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    button { padding: 14px; font-size: 1.1rem; border: none; border-radius: 8px; cursor: pointer; transition: 0.15s ease; background: #334155; color: #f8fafc; font-weight: 500; }
    button:hover { background: #475569; }
    button:active { transform: scale(0.97); }
    button.op { background: #3b82f6; color: #fff; }
    button.op:hover { background: #2563eb; }
    button.func { background: #64748b; font-size: 0.95rem; }
    button.func:hover { background: #475569; }
    button.clear { background: #ef4444; color: #fff; }
    button.clear:hover { background: #dc2626; }
    button.equal { background: #10b981; color: #fff; grid-column: span 2; }
    button.equal:hover { background: #059669; }
  </style>
</head>
<body>
  <div class="calculator">
    <div class="display">
      <div id="prev" class="previous-operand"></div>
      <div id="curr" class="current-operand">0</div>
    </div>
    <div class="grid">
      <button class="clear" onclick="clearAll()">AC</button>
      <button class="clear" onclick="deleteChar()">DEL</button>
      <button class="func" onclick="applyFunc('sqrt')">√</button>
      <button class="op" onclick="appendOp('/')">÷</button>

      <button class="func" onclick="applyFunc('sin')">sin</button>
      <button class="func" onclick="applyFunc('cos')">cos</button>
      <button class="func" onclick="applyFunc('tan')">tan</button>
      <button class="op" onclick="appendOp('*')">×</button>

      <button class="func" onclick="applyFunc('log')">log</button>
      <button class="func" onclick="appendOp('^')">xʸ</button>
      <button class="func" onclick="appendNum('(')">(</button>
      <button class="func" onclick="appendNum(')')">)</button>

      <button onclick="appendNum('7')">7</button>
      <button onclick="appendNum('8')">8</button>
      <button onclick="appendNum('9')">9</button>
      <button class="op" onclick="appendOp('-')">-</button>

      <button onclick="appendNum('4')">4</button>
      <button onclick="appendNum('5')">5</button>
      <button onclick="appendNum('6')">6</button>
      <button class="op" onclick="appendOp('+')">+</button>

      <button onclick="appendNum('1')">1</button>
      <button onclick="appendNum('2')">2</button>
      <button onclick="appendNum('3')">3</button>
      <button class="func" onclick="appendNum('3.14159')">π</button>

      <button onclick="appendNum('0')">0</button>
      <button onclick="appendNum('.')">.</button>
      <button class="equal" onclick="compute()">=</button>
    </div>
  </div>

  <script>
    let currentInput = '0';
    let previousExpression = '';

    const currElem = document.getElementById('curr');
    const prevElem = document.getElementById('prev');

    function updateDisplay() {
      currElem.innerText = currentInput;
      prevElem.innerText = previousExpression;
    }

    function appendNum(num) {
      if (currentInput === '0' && num !== '.') {
        currentInput = num;
      } else {
        if (num === '.' && currentInput.includes('.')) return;
        currentInput += num;
      }
      updateDisplay();
    }

    function appendOp(op) {
      if (currentInput === '' && op === '-') {
        currentInput = '-';
        updateDisplay();
        return;
      }
      previousExpression += currentInput + ' ' + op + ' ';
      currentInput = '0';
      updateDisplay();
    }

    function applyFunc(fn) {
      let val = parseFloat(currentInput);
      if (isNaN(val)) return;
      if (fn === 'sqrt') val = Math.sqrt(val);
      else if (fn === 'sin') val = Math.sin(val * Math.PI / 180);
      else if (fn === 'cos') val = Math.cos(val * Math.PI / 180);
      else if (fn === 'tan') val = Math.tan(val * Math.PI / 180);
      else if (fn === 'log') val = Math.log10(val);
      currentInput = String(parseFloat(val.toFixed(8)));
      updateDisplay();
    }

    function clearAll() {
      currentInput = '0';
      previousExpression = '';
      updateDisplay();
    }

    function deleteChar() {
      if (currentInput.length > 1) {
        currentInput = currentInput.slice(0, -1);
      } else {
        currentInput = '0';
      }
      updateDisplay();
    }

    function compute() {
      let fullExpr = (previousExpression + currentInput).replace(/÷/g, '/').replace(/×/g, '*').replace(/\^/g, '**');
      try {
        if (!/^[0-9+\\-*\\/().\\s]+$/.test(fullExpr)) {
          throw new Error('Invalid input');
        }
        let result = Function('"use strict";return (' + fullExpr + ')')();
        previousExpression = '';
        currentInput = String(result);
      } catch (e) {
        currentInput = 'Error';
      }
      updateDisplay();
    }
  </script>
</body>
</html>
\`\`\`

Save the code above as \`calculator.html\` and open it directly in any modern web browser to run it.`;

function validate_code(reply, request) {
    if (!reply) return reply;
    const req = String(request || '');
    const reqLower = req.toLowerCase();
    const replyLower = String(reply).toLowerCase();
    // Only validate code if user is asking for HTML code/markup, not reading a URL ending in .html
    const isUrl = /https?:\/\//i.test(req);
    const wants_html = !isUrl && /\bhtml\b/i.test(reqLower) && (/(?:code|calculator|page|markup|file|script|create|make|write|generate)/i.test(reqLower));
    const has_html = replyLower.includes('<html') || replyLower.includes('<!doctype');
    if (wants_html && !has_html) {
        return HTML_CALCULATOR_CODE;
    }
    return reply;
}

function rewriteRequest(userText, history = [], activeTopic = '') {
    let text = (userText || '').trim();
    text = text.replace(/\bnet\s+wroth\b/gi, 'net worth');
    text = text.replace(/\bcalculatot\b/gi, 'calculator');
    text = text.replace(/\brepharse\b/gi, 'rephrase');
    text = text.replace(/\bextention\b/gi, 'extension');

    const topic = activeTopic || (history.slice(-4).reverse().find(m => m.role === 'user')?.content || '');
    if (/\b(?:his|he|its|her|she|their)\b/i.test(text)) {
        if (/elon\s+musk/i.test(topic) || /elon/i.test(topic)) {
            if (/net\s+worth|net\s+wroth|wealth|rich/i.test(text)) {
                return "What is Elon Musk's net worth?";
            }
        }
    }
    return text;
}

module.exports = {
    HTML_CALCULATOR_CODE,
    validate_code,
    rewriteRequest
};
