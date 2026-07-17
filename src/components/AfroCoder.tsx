import './AfroCoder.css';

export function AfroCoder() {
  return (
    <div className="afro-coder-wrap">
      <svg viewBox="0 0 500 480" className="afro-svg">
        <defs>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000" floodOpacity="0.18" />
          </filter>
          <filter id="screenBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <radialGradient id="ambientGlow" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="var(--accent, #2f4d78)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent, #2f4d78)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="screenLight" cx="50%" cy="30%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="deskGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--border2, #2a2a2a)" />
            <stop offset="100%" stopColor="var(--border, #1a1a1a)" />
          </linearGradient>
          <linearGradient id="laptopBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#555" />
            <stop offset="100%" stopColor="#333" />
          </linearGradient>
          {/* Stunning deep navy gradient matching the logo */}
          <linearGradient id="afroGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2f4d78" />
            <stop offset="55%" stopColor="#1c3255" />
            <stop offset="100%" stopColor="#0f1b2d" />
          </linearGradient>
        </defs>

        {/* Ambient glow behind the workspace */}
        <ellipse cx="250" cy="260" rx="200" ry="160" fill="url(#ambientGlow)" className="afro-ambient" />

        <g filter="url(#softShadow)">
          {/* ── DESK ──────────────────────────────── */}
          <rect x="60" y="335" width="380" height="12" rx="6" fill="url(#deskGrad)" />
          <rect x="80" y="347" width="340" height="4" rx="2" fill="var(--border, #1a1a1a)" opacity="0.5" />

          {/* ── LAPTOP ────────────────────────────── */}
          {/* Base */}
          <rect x="115" y="322" width="155" height="14" rx="4" fill="url(#laptopBody)" />
          {/* Keyboard hint */}
          <rect x="125" y="325" width="135" height="6" rx="2" fill="#444" opacity="0.5" />
          {/* Touchpad */}
          <rect x="170" y="326" width="40" height="4" rx="2" fill="#4a4a4a" opacity="0.4" />

          {/* Screen bezel */}
          <rect x="120" y="210" width="145" height="115" rx="6" fill="#222" />
          {/* Screen */}
          <rect x="126" y="216" width="133" height="100" rx="3" fill="#0d1117" />

          {/* ── CODE EDITOR ON SCREEN ─────────────── */}
          {/* Editor top bar */}
          <rect x="126" y="216" width="133" height="14" rx="3" fill="#161b22" />
          <circle cx="136" cy="223" r="2.5" fill="#ff5f57" />
          <circle cx="144" cy="223" r="2.5" fill="#febc2e" />
          <circle cx="152" cy="223" r="2.5" fill="#28c840" />
          <rect x="175" y="220" width="60" height="6" rx="2" fill="#21262d" />

          {/* Corrected & Beautified Code Lines */}
          <g className="afro-code-lines">
            {/* Line numbers */}
            <text x="131" y="244" className="afro-line-num">1</text>
            <text x="131" y="254" className="afro-line-num">2</text>
            <text x="131" y="264" className="afro-line-num">3</text>
            <text x="131" y="274" className="afro-line-num">4</text>
            <text x="131" y="284" className="afro-line-num">5</text>
            <text x="131" y="294" className="afro-line-num">6</text>
            <text x="131" y="304" className="afro-line-num">7</text>
            <text x="131" y="312" className="afro-line-num">8</text>

            {/* Syntax-highlighted realistic React code */}
            <text x="142" y="244" className="afro-code-kw">import</text>
            <text x="172" y="244" className="afro-code-var">React</text>
            <text x="198" y="244" className="afro-code-kw">from</text>
            <text x="220" y="244" className="afro-code-str-val">'react'</text>

            <text x="142" y="254" className="afro-code-kw">const</text>
            <text x="168" y="254" className="afro-code-var">AfroTech</text>
            <text x="206" y="254" className="afro-code-op">=</text>
            <text x="214" y="254" className="afro-code-br">()</text>
            <text x="224" y="254" className="afro-code-op">=&gt;</text>
            <text x="236" y="254" className="afro-code-br">{"{"}</text>

            <text x="150" y="264" className="afro-code-kw">return</text>
            <text x="180" y="264" className="afro-code-br">(</text>

            <text x="158" y="274" className="afro-code-op">&lt;</text>
            <text x="163" y="274" className="afro-code-fn">Coder</text>

            <text x="166" y="284" className="afro-code-str">status</text>
            <text x="194" y="284" className="afro-code-op">=</text>
            <text x="200" y="284" className="afro-code-str-val">"active"</text>

            <text x="158" y="294" className="afro-code-op">/&gt;</text>

            <text x="150" y="304" className="afro-code-br">);</text>
            <text x="142" y="312" className="afro-code-br">{"};"}</text>

            {/* Cursor blink */}
            <rect x="155" y="314" width="6" height="1" rx="0.5" className="afro-cursor" />
          </g>

          {/* Screen reflection */}
          <rect x="126" y="216" width="133" height="100" rx="3" fill="url(#screenLight)" />

          {/* ── PERSON ─────────────────────────────── */}
          {/* Elegant body contours with collar styling */}
          <path d="M 310 365 C 310 305 335 270 395 270 C 440 270 465 300 465 365 Z" className="afro-body" />

          {/* ── HEAD ─────────────────────────────────────────────── */}
          <g className="afro-head-group" transform="rotate(-15, 380, 200) translate(-10, 30)">
            {/* Afro — perfectly smooth voluminous sphere */}
            <circle cx="420" cy="125" r="110" fill="url(#afroGrad)" className="afro-hair" />

            {/* Face profile — facing LEFT toward the laptop */}
            <path
              d="M 350 130
                 C 335 140, 325 160, 325 175
                 C 315 180, 315 195, 325 195
                 C 320 200, 320 210, 330 210
                 C 325 215, 330 230, 350 240
                 C 360 245, 370 260, 370 275
                 L 430 275
                 L 430 130 Z"
              fill="#8d5524"
              className="afro-face"
            />

            {/* Ear — on the right (back of head when facing left) */}
            <circle cx="410" cy="190" r="9" fill="#7a481e" className="afro-ear" />

            {/* Eye — face side (left) */}
            <ellipse cx="339" cy="194" rx="2.8" ry="2.6" className="afro-eye" />

            {/* Eyebrow */}
            <path d="M 332 186 Q 340 182 348 185" fill="none" className="afro-eyebrow" strokeWidth="1.8" strokeLinecap="round" />

            {/* Nostril hint */}
            <circle cx="331" cy="216" r="1.5" className="afro-nostril" />

            {/* Mouth line */}
            <path d="M 338 230 Q 344 233 350 230" fill="none" className="afro-mouth" strokeWidth="1.2" strokeLinecap="round" />
          </g>

          {/* Circuit trace accent */}
          <g className="afro-circuit">
            <path
              d="M 345 300 L 360 300 L 360 312 L 375 312 L 375 300 L 390 300 L 390 320 L 405 320"
              fill="none"
              className="afro-circuit-line"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="345" cy="300" r="2.5" className="afro-circuit-node" />
            <circle cx="375" cy="312" r="2.5" className="afro-circuit-node" />
            <circle cx="405" cy="320" r="2.5" className="afro-circuit-node" />
          </g>

          {/* ── SLEEK ARMS AND VECTOR TYPING HANDS ── */}
          <path d="M 335 310 Q 270 335 210 325" className="afro-arm afro-arm-l" fill="none" strokeWidth="16" strokeLinecap="round" />
          <path d="M 355 305 Q 285 325 215 328" className="afro-arm afro-arm-r" fill="none" strokeWidth="16" strokeLinecap="round" />
          
          {/* Left typing hand with elegant, articulated fingers */}
          <g className="afro-hand-l-group">
            <path d="M 210 325 C 205 320, 195 322, 192 328 C 190 332, 195 338, 205 338 C 212 338, 215 330, 210 325 Z" fill="#8d5524" />
            <path d="M 198 326 L 188 324" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 196 330 L 185 328" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 198 334 L 188 332" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
          </g>

          {/* Right typing hand with elegant, articulated fingers */}
          <g className="afro-hand-r-group">
            <path d="M 215 328 C 210 323, 200 325, 197 331 C 195 335, 200 341, 210 341 C 217 341, 220 333, 215 328 Z" fill="#8d5524" />
            <path d="M 203 329 L 193 327" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 201 333 L 190 331" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 203 337 L 193 335" stroke="#8d5524" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </g>

        {/* ── FLOATING TECH ELEMENTS ─────────────── */}
        <g className="afro-float-group">
          <text x="60" y="140" className="afro-float-sym afro-float-1">{"{ }"}</text>
          <text x="380" y="120" className="afro-float-sym afro-float-2">{">_"}</text>
          <text x="50" y="300" className="afro-float-sym afro-float-3">01</text>
          <text x="400" y="280" className="afro-float-sym afro-float-4">{"</>"}</text>
          <circle cx="75" cy="210" r="4" fill="var(--accent, #2f4d78)" opacity="0.5" className="afro-float-5" />
          <circle cx="420" cy="200" r="3" fill="var(--accent, #2f4d78)" opacity="0.4" className="afro-float-6" />
          <text x="390" y="380" className="afro-float-sym afro-float-7">{"⚙"}</text>
        </g>
      </svg>
    </div>
  );
}