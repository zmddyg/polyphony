let sceneIndex = 0;

const mzi = (id) => `
  <defs>
    <pattern id="${id}-grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" stroke="#9bdbb0" stroke-opacity=".16" fill="none"/>
      <circle cx="0" cy="0" r="1.1" fill="#c5ef7c" opacity=".42"/>
    </pattern>
    <linearGradient id="${id}-beam" x2="1" y2="0">
      <stop stop-color="#e8ffa6"/><stop offset=".45" stop-color="#98f0c1"/><stop offset="1" stop-color="#f4fbd4"/>
    </linearGradient>
    <linearGradient id="${id}-optic" x2="1" y2="1">
      <stop stop-color="#e4fff1" stop-opacity=".8"/><stop offset="1" stop-color="#539376" stop-opacity=".3"/>
    </linearGradient>
    <filter id="${id}-glow" x="-40%" y="-100%" width="180%" height="300%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <path id="${id}-light" d="M68 180H156L246 90H417L507 180H643M156 180L246 270H417L507 180"/>
  </defs>
  <path d="M55 48H664V302H55Z" fill="url(#${id}-grid)" opacity=".7"/>
  <path d="M55 78V48H85M634 48H664V78M664 272V302H634M85 302H55V272" fill="none" stroke="#93c8a8" opacity=".55"/>
  <path d="M55 180H661M332 48V302" stroke="#8bb09a" stroke-opacity=".35" stroke-dasharray="4 7"/>
  <g fill="#a5c7ae" font-family="monospace" font-size="10" letter-spacing="1.8">
    <text x="68" y="67">OPTICAL PATH</text><text x="528" y="67">Δφ = 0</text>
    <text x="102" y="220">BS1</text><text x="477" y="221">BS2</text>
    <text x="313" y="72">ARM 1</text><text x="313" y="296">ARM 2</text>
  </g>
  <g fill="none">
    <path d="M156 180L246 90H417L507 180L417 270H246Z" stroke="#80cab5" stroke-opacity=".3" stroke-width="34"/>
    <path d="M156 180L246 90H417L507 180L417 270H246Z" stroke="#132d26" stroke-width="31"/>
    <path d="M156 180L246 90H417L507 180L417 270H246Z" stroke="#284d3d" stroke-width="2" transform="translate(0 13)"/>
    <use href="#${id}-light" stroke="url(#${id}-beam)" stroke-width="8" opacity=".65" filter="url(#${id}-glow)"/>
    <path d="M68 180H156L246 90H417L507 180H643M156 180L246 270H417L507 180" stroke="url(#${id}-beam)" stroke-width="2.7"/>
    <path d="M72 186H154L246 96H414L505 186H641M153 174L248 264H414L505 174" stroke="#7bdcb5" opacity=".67" stroke-width=".9"/>
    <path d="M507 180L612 263" stroke="#8aa996" stroke-opacity=".72" stroke-width="1.4" stroke-dasharray="4 6"/>
  </g>
  <g stroke="#90e1b5">
    <path d="M222 106L241 79L256 79L237 106ZM407 79H422L441 106H426ZM222 254L237 254L256 281H241ZM407 281L426 254H441L422 281Z" fill="url(#${id}-optic)" stroke-width="1"/>
    <path d="M250 84H413M250 276H413" opacity=".35"/>
  </g>
  <g transform="translate(156 180)">
    <path d="M-16 -14L3 -22L17 -11L17 15L-2 24L-16 12Z" fill="#a0f4c0" fill-opacity=".18" stroke="#b7f0cd"/>
    <path d="M-16 -14L-2 -4L17 -11M-2 -4V24M-16 12L3 -22M-2 24L17 -11" fill="none" stroke="#b7f0cd" stroke-opacity=".7"/>
  </g>
  <g transform="translate(507 180)">
    <path d="M-16 -14L3 -22L17 -11L17 15L-2 24L-16 12Z" fill="#a0f4c0" fill-opacity=".18" stroke="#b7f0cd"/>
    <path d="M-16 -14L-2 -4L17 -11M-2 -4V24M-16 12L3 -22M-2 24L17 -11" fill="none" stroke="#b7f0cd" stroke-opacity=".7"/>
  </g>
  <path d="M68 173L76 180L68 187L60 180Z" fill="#e7ffa6"/>
  <circle cx="643" cy="180" r="9" fill="#dfff91" opacity=".26"/><circle cx="643" cy="180" r="3.5" fill="#efffc2"/>
  <circle cx="612" cy="263" r="5" fill="#152e24" stroke="#a2baa7"/>
  <g font-family="monospace" font-size="11" letter-spacing="1">
    <text x="603" y="161" fill="#efffc2">A / 100%</text>
    <text x="621" y="267" fill="#b2c6b8">B / 0%</text>
  </g>
`;

const history = () => `
  <path d="M87 61h545v234H87Z" stroke="#719582" opacity=".45" stroke-dasharray="4 7" fill="none"/>
  <g transform="translate(154 76) rotate(-12 107 104)">
    <path d="M1 0h214v206H1Z" fill="#e2cfa2"/>
    <path d="M13 13h190v180H13Z" fill="none" stroke="#77684e" stroke-width="2"/>
    <text x="31" y="62" fill="#453c2e" font-size="22" font-family="serif">夜校宣传单</text>
    <path d="M31 77h148M31 96h151M31 109h84M31 121h147M31 133h98" stroke="#8d7753" opacity=".8"/>
  </g>
  <g transform="translate(360 76) rotate(11 110 100)">
    <path d="M0 0h222v203H0Z" fill="#a9c5aa"/>
    <path d="M22 78h172M22 92h172M22 106h172M22 120h172M22 134h172M22 148h172M22 162h172" stroke="#607f67" opacity=".75"/>
    <text x="22" y="58" fill="#2f4736" font-size="21" font-family="serif">学员回忆</text>
  </g>
  <g transform="translate(257 57) rotate(-2 106 123)">
    <path d="M0 0h212v246H0Z" fill="#f6edd4" stroke="#bcae8c"/>
    <path d="M18 18h176v210H18Z" fill="none" stroke="#b6aa89"/>
    <text x="35" y="57" fill="#343c2b" font-family="serif" font-size="24">夜校点名册</text>
    <text x="36" y="80" fill="#69634e" font-family="monospace" font-size="11" letter-spacing="2">1932 / 秋</text>
    <path d="M34 96h145M34 120h145M34 143h145M34 166h145M34 189h145M34 212h145M104 96v116" stroke="#a89c80"/>
    <g font-family="monospace" font-size="12" fill="#3b4834">
      <text x="51" y="113">MON</text><text x="131" y="113">42</text>
      <text x="51" y="137">TUE</text><text x="131" y="137">58</text>
      <text x="51" y="160">WED</text><text x="131" y="160">63</text>
      <text x="51" y="183">THU</text><text x="131" y="183">51</text>
      <text x="51" y="206">FRI</text><text x="131" y="206">49</text>
    </g>
  </g>
`;

const blackbox = (_id, hideExample) => `
  <path d="M81 58h558v241H81Z" fill="none" stroke="#6c9582" stroke-opacity=".6" stroke-dasharray="4 6"/>
  <path d="M110 179h155m200 0h141M362 179v-73h166M362 179v75h166" fill="none" stroke="#a4d9b4" stroke-width="1.5"/>
  <path d="M362 106h166" fill="none" stroke="#c5ef7c" stroke-width="2"/>
  <path d="M362 254h166" fill="none" stroke="#86d8bf" stroke-width="2"/>
  <g stroke="#b4d7be" stroke-width="1">
    <path d="M265 139l94-40 107 40v79l-107 38-94-38Z" fill="#152f25"/>
    <path d="M265 139l94 42 107-42M359 181v75" fill="none"/>
    <path d="M277 139l82-34 93 34-93 35Z" fill="#769c7e" opacity=".3"/>
  </g>
  <g fill="#d7e7dc" font-family="monospace" font-size="15" letter-spacing="1">
    <text x="110" y="165">${hideExample ? "输入 x" : "x = 3"}</text><text x="392" y="202">?</text>
    <text x="546" y="111" fill="#c5ef7c">${hideExample ? "x²" : "x² → 9"}</text>
    <text x="546" y="259" fill="#86d8bf">${hideExample ? "2x" : "2x → 6"}</text>
  </g>
  <circle cx="110" cy="179" r="5" fill="#daeddd"/><circle cx="528" cy="106" r="5" fill="#c5ef7c"/><circle cx="528" cy="254" r="5" fill="#86d8bf"/>
  <path d="M596 174l10 5-10 5Z" fill="#a4d9b4"/>
`;

function scoreGraphic() {
  const voices = [0, 1, 2, 3, 4].map((n) => {
    const y = 91 + n * 39;
    return '<path stroke="'+(n % 2 ? '#92cdb3' : '#d1e8a2')+'" d="M122 ' + y + 'h100c72 0 49 ' + (170-y) + ' 132 ' + (170-y) + 'h57" fill="none" stroke-width="2.4"/><circle cx="122" cy="'+y+'" r="5" fill="#cae2b0"/>';
  }).join('');
  return '<g fill="none" stroke="#7fa78f" opacity=".42"><rect x="82" y="57" width="548" height="238" rx="8" stroke-dasharray="4 7"/><path d="M100 170h520M350 67v213" stroke-dasharray="2 8"/></g>'+voices+
    '<g stroke="#bbd9bc" stroke-width="2" fill="none"><path d="M394 170c61 0 62-62 111-62h64M394 170h175M394 170c61 0 62 62 111 62h64"/></g><g fill="#c3e98f"><rect x="362" y="150" width="40" height="40" rx="8" transform="rotate(45 382 170)"/><circle cx="574" cy="108" r="6"/><circle cx="574" cy="170" r="6"/><circle cx="574" cy="232" r="6"/></g>';
}

export function sceneGraphic(lessonId, { hideExample = false } = {}) {
  const id = `polyphony-scene-${++sceneIndex}`;
  const scenes = {
    mzi: [mzi, '马赫–曾德尔干涉仪的对称光路及相位差为零时的两个出口'],
    history: [history, '宣传单、点名册和回忆组成的课堂模拟史料'],
    blackbox: [blackbox, '输入 3 时，平方和倍增两条规则给出不同预测'],
    choice: [scoreGraphic, '学生意见汇入课谱，由教师选择下一条教学分支'],
  };
  const [draw, label] = scenes[lessonId] ?? scenes.choice;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="348" viewBox="0 0 720 348" class="poly-scene-graphic" role="img" aria-labelledby="${id}-title" style="display:block;width:100%;height:auto"><title id="${id}-title">${hideExample && lessonId === "blackbox" ? "数字黑箱与两条候选规则" : label}</title>${draw(id, hideExample)}</svg>`;
}

