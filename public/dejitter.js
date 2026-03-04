/**
 * Dejitter — Animation frame recorder & jank detector
 *
 * Inject into a page via evaluate_script or <script> tag.
 * Records every rAF at full speed, then downsamples intelligently on getData():
 *
 *   - Properties with zero changes across all frames → dropped entirely
 *   - Properties with fewer changes than the target sample count → kept as-is (anomalies)
 *   - Properties with more changes than the target sample count → evenly downsampled
 *
 * Usage:
 *   dejitter.configure({ selector: 'main', props: ['opacity','transform'], sampleRate: 10 });
 *   dejitter.start();
 *   // ... interact with the page ...
 *   dejitter.stop();
 *   dejitter.getData();  // → { samples: [...], summary: {...} }
 */

(() => {
  const DEFAULT_CONFIG = {
    /** CSS selector for elements to track. Use '*' with caution. */
    selector: '*',
    /**
     * Computed style properties to sample.
     * Use 'boundingRect' to include getBoundingClientRect() x/y/width/height.
     * Use 'scroll' to track scrollTop/scrollHeight on the matched element.
     * Use 'textContent' to track innerText length changes.
     * Any CSS custom property (e.g. '--sp') works too.
     */
    props: ['opacity', 'transform'],
    /** Target samples per second for downsampling output. Recording always runs at full rAF. */
    sampleRate: 15,
    /** Max recording duration in ms. 0 = unlimited (call stop() manually). */
    maxDuration: 10000,
    /** Ignore elements whose textContent is shorter than this. Helps filter noise. */
    minTextLength: 0,
    /** If true, also observe DOM mutations (added/removed nodes, text changes). */
    mutations: false,
    /** Auto-stop after this many ms of no changes (samples or mutations). 0 = disabled. */
    idleTimeout: 2000,
  };

  let config = { ...DEFAULT_CONFIG };
  let recording = false;
  let startTime = 0;
  let rafId = null;
  let stopTimer = null;
  let mutationObserver = null;

  // Callbacks invoked after stop()
  let onStopCallbacks = [];

  // --- Raw recording (full rAF speed) ---

  // Per-element last-seen values for delta detection during recording
  // Map<elemId, Record<propKey, value>>
  let lastSeen = new Map();

  // Raw frames: every rAF that had at least one change
  // Array<{ t: number, changes: Array<{ id, ...propDeltas }> }>
  let rawFrames = [];

  // Timestamp of last observed change (sample or mutation), for idle auto-stop
  let lastChangeTime = 0;
  // Whether we've seen at least one real change (beyond the initial snapshot)
  let hasSeenChange = false;

  // Mutation events (separate stream, always full resolution)
  let mutations = [];

  // Element identity
  let nextElemId = 0;
  function elemId(el) {
    if (!el.__dj_id) {
      el.__dj_id = `e${nextElemId++}`;
      el.__dj_label = {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
        text: (el.textContent || '').trim().slice(0, 60),
      };
    }
    return el.__dj_id;
  }

  function readProps(el) {
    const out = {};
    const computed = getComputedStyle(el);
    for (const p of config.props) {
      if (p === 'boundingRect') {
        const r = el.getBoundingClientRect();
        out['rect.x'] = Math.round(r.x);
        out['rect.y'] = Math.round(r.y);
        out['rect.w'] = Math.round(r.width);
        out['rect.h'] = Math.round(r.height);
      } else if (p === 'scroll') {
        out['scrollTop'] = Math.round(el.scrollTop);
        out['scrollHeight'] = Math.round(el.scrollHeight);
      } else if (p === 'textContent') {
        out['textLen'] = (el.textContent || '').length;
      } else {
        out[p] = computed.getPropertyValue(p);
      }
    }
    return out;
  }

  function computeDelta(id, current) {
    const prev = lastSeen.get(id);
    if (!prev) {
      lastSeen.set(id, { ...current });
      return current;
    }
    const delta = {};
    let changed = false;
    for (const [k, v] of Object.entries(current)) {
      if (prev[k] !== v) {
        delta[k] = v;
        prev[k] = v;
        changed = true;
      }
    }
    return changed ? delta : null;
  }

  function sampleAll() {
    const t = Math.round(performance.now() - startTime);
    const elements = document.querySelectorAll(config.selector);
    const frameDelta = [];

    elements.forEach((el) => {
      if (config.minTextLength > 0) {
        if ((el.textContent || '').trim().length < config.minTextLength) return;
      }
      const id = elemId(el);
      const current = readProps(el);
      const delta = computeDelta(id, current);
      if (delta) {
        frameDelta.push({ id, ...delta });
      }
    });

    if (frameDelta.length > 0) {
      rawFrames.push({ t, changes: frameDelta });
      if (rawFrames.length > 1) hasSeenChange = true;
      lastChangeTime = performance.now();
    }
  }

  // Always run at full rAF — no throttling during recording
  function loop() {
    if (!recording) return;

    // Idle auto-stop: only after the first real modification is observed
    if (config.idleTimeout > 0 && hasSeenChange) {
      if (performance.now() - lastChangeTime >= config.idleTimeout) {
        dejitter.stop();
        return;
      }
    }

    sampleAll();
    rafId = requestAnimationFrame(loop);
  }

  function startMutationObserver() {
    if (!config.mutations) return;
    mutationObserver = new MutationObserver((muts) => {
      if (!recording) return;
      const t = Math.round(performance.now() - startTime);
      lastChangeTime = performance.now();
      hasSeenChange = true;
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === 3) {
              const text = node.textContent?.trim();
              if (text) mutations.push({ t, type: 'text+', text: text.slice(0, 120), parent: m.target.tagName?.toLowerCase() });
            } else if (node.nodeType === 1) {
              const text = (node.textContent || '').trim().slice(0, 80);
              mutations.push({ t, type: 'node+', tag: node.tagName.toLowerCase(), text });
            }
          }
          for (const node of m.removedNodes) {
            if (node.nodeType === 1) {
              mutations.push({ t, type: 'node-', tag: node.tagName.toLowerCase(), text: (node.textContent || '').trim().slice(0, 40) });
            }
          }
        } else if (m.type === 'characterData') {
          const text = m.target.textContent?.trim();
          if (text) mutations.push({ t, type: 'text~', text: text.slice(0, 120), parent: m.target.parentElement?.tagName?.toLowerCase() });
        }
      }
    });
    mutationObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
  }

  // --- Downsampling ---

  /**
   * Downsample raw frames into the final output.
   *
   * For each (element, property) pair:
   *   - Count how many raw frames contain a change for it
   *   - If 0 changes → drop the property entirely
   *   - If changes <= targetFrames → keep all of them (anomaly — rare discrete changes)
   *   - If changes > targetFrames → evenly sample down to targetFrames
   */
  function downsample() {
    if (rawFrames.length === 0) return [];

    const duration = rawFrames[rawFrames.length - 1].t;
    const targetFrames = Math.max(1, Math.round((duration / 1000) * config.sampleRate));

    // Step 1: Index all (elem, prop) change events with their frame index
    // Map<"elemId.propKey", Array<{ frameIdx, t, value }>>
    const changeIndex = new Map();

    for (let fi = 0; fi < rawFrames.length; fi++) {
      const frame = rawFrames[fi];
      for (const change of frame.changes) {
        const { id, ...props } = change;
        for (const [prop, value] of Object.entries(props)) {
          const key = `${id}.${prop}`;
          if (!changeIndex.has(key)) changeIndex.set(key, []);
          changeIndex.get(key).push({ frameIdx: fi, t: frame.t, value });
        }
      }
    }

    // Step 2: Classify each (elem, prop) and build the output timeline
    // We collect events into a flat list then group by time
    const outputEvents = []; // Array<{ t, id, prop, value }>

    for (const [key, changes] of changeIndex.entries()) {
      const dotIdx = key.indexOf('.');
      const id = key.slice(0, dotIdx);
      const prop = key.slice(dotIdx + 1);

      if (changes.length === 0) continue; // dropped (zero changes)

      if (changes.length <= targetFrames) {
        // Anomaly: keep all — these are rare discrete changes
        for (const c of changes) {
          outputEvents.push({ t: c.t, id, prop, value: c.value });
        }
      } else {
        // Frequent: evenly downsample
        for (let i = 0; i < targetFrames; i++) {
          const srcIdx = Math.round((i / (targetFrames - 1)) * (changes.length - 1));
          const c = changes[srcIdx];
          outputEvents.push({ t: c.t, id, prop, value: c.value });
        }
      }
    }

    // Step 3: Group output events by timestamp into frames
    outputEvents.sort((a, b) => a.t - b.t);
    const frames = [];
    let currentFrame = null;

    for (const evt of outputEvents) {
      if (!currentFrame || currentFrame.t !== evt.t) {
        currentFrame = { t: evt.t, changes: [] };
        frames.push(currentFrame);
      }
      // Find or create the change entry for this element
      let elemChange = currentFrame.changes.find((c) => c.id === evt.id);
      if (!elemChange) {
        elemChange = { id: evt.id };
        currentFrame.changes.push(elemChange);
      }
      elemChange[evt.prop] = evt.value;
    }

    return frames;
  }

  function buildElementMap() {
    const elements = {};
    const seenIds = new Set();
    for (const f of rawFrames) {
      for (const c of f.changes) seenIds.add(c.id);
    }
    document.querySelectorAll('*').forEach((el) => {
      if (el.__dj_id && seenIds.has(el.__dj_id)) {
        elements[el.__dj_id] = el.__dj_label || {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 60),
        };
      }
    });
    return elements;
  }

  function buildPropStats() {
    // Per (elem, prop): count raw changes
    const stats = {}; // { "elemId.prop": { raw, output, mode } }
    const duration = rawFrames.length ? rawFrames[rawFrames.length - 1].t : 0;
    const targetFrames = Math.max(1, Math.round((duration / 1000) * config.sampleRate));

    for (const f of rawFrames) {
      for (const change of f.changes) {
        const { id, ...props } = change;
        for (const prop of Object.keys(props)) {
          const key = `${id}.${prop}`;
          if (!stats[key]) stats[key] = { elem: id, prop, raw: 0 };
          stats[key].raw++;
        }
      }
    }

    for (const s of Object.values(stats)) {
      if (s.raw === 0) {
        s.mode = 'dropped';
        s.output = 0;
      } else if (s.raw <= targetFrames) {
        s.mode = 'anomaly';
        s.output = s.raw;
      } else {
        s.mode = 'sampled';
        s.output = targetFrames;
      }
    }

    return { targetFrames, props: Object.values(stats) };
  }

  // --- Analysis ---

  /**
   * Extract raw value timeline for a specific (element, property) pair.
   * Returns Array<{ t, value }> from rawFrames.
   */
  function getTimeline(elemId, prop) {
    const timeline = [];
    for (const frame of rawFrames) {
      for (const c of frame.changes) {
        if (c.id === elemId && c[prop] !== undefined) {
          timeline.push({ t: frame.t, value: c[prop] });
        }
      }
    }
    return timeline;
  }

  /**
   * Parse a numeric value from a CSS property value.
   * Handles: plain numbers, "matrix(1, 0, 0, 1, 0, -69)" → extracts translateY,
   * "none" → 0, etc.
   */
  function extractNumeric(value) {
    if (value === 'none' || value === '' || value === 'auto') return 0;
    // matrix(a, b, c, d, tx, ty) → return ty (translateY) as most interesting
    const matrixMatch = String(value).match(/^matrix\(([^)]+)\)$/);
    if (matrixMatch) {
      const parts = matrixMatch[1].split(',').map(Number);
      // Return the component with largest absolute value (most movement)
      const tx = parts[4] || 0;
      const ty = parts[5] || 0;
      return Math.abs(tx) > Math.abs(ty) ? tx : ty;
    }
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }

  /**
   * Detect bounce pattern: value starts at rest, deviates, returns to rest.
   * Returns { peak, peakT, duration } or null.
   */
  function detectBounce(timeline) {
    if (timeline.length < 3) return null;

    const first = timeline[0].value;
    const last = timeline[timeline.length - 1].value;

    // Must start and end at the same value (rest state)
    if (first !== last) return null;

    // Must have different values in between
    const firstNum = extractNumeric(first);
    if (firstNum === null) return null;

    let peakDeviation = 0;
    let peakT = 0;
    let peakValue = first;
    for (const { t, value } of timeline) {
      const num = extractNumeric(value);
      if (num === null) continue;
      const deviation = Math.abs(num - firstNum);
      if (deviation > peakDeviation) {
        peakDeviation = deviation;
        peakT = t;
        peakValue = value;
      }
    }

    if (peakDeviation === 0) return null;

    return {
      restValue: first,
      peak: peakValue,
      peakDeviation: Math.round(peakDeviation * 10) / 10,
      peakT,
      startT: timeline[0].t,
      endT: timeline[timeline.length - 1].t,
      duration: timeline[timeline.length - 1].t - timeline[0].t,
    };
  }

  /**
   * Detect outlier properties on an element.
   * A property is an outlier if its change count is significantly different
   * from the median of its sibling properties on the same element.
   */
  function detectOutliers(propStats) {
    // Group by element
    const byElem = {};
    for (const p of propStats.props) {
      if (!byElem[p.elem]) byElem[p.elem] = [];
      byElem[p.elem].push(p);
    }

    const outliers = [];
    for (const [elem, props] of Object.entries(byElem)) {
      if (props.length < 2) continue;

      const counts = props.map((p) => p.raw).sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)];

      for (const p of props) {
        // Skip if only 1 change (initial value) — not interesting
        if (p.raw <= 1) continue;
        // Outlier: significantly different from median, and not in the majority
        const ratio = median > 0 ? p.raw / median : p.raw;
        const isOutlier =
          (ratio > 3 || ratio < 0.33) && // 3x different from median
          p.raw !== counts[counts.length - 1] && // not the most common count
          p.raw !== counts[0]; // not the least common count (usually 1)
        if (isOutlier) {
          outliers.push({ ...p, median, ratio: Math.round(ratio * 10) / 10 });
        }
      }
    }
    return outliers;
  }

  // --- Finding helpers ---

  function makeFinding(type, severity, elem, elemLabel, prop, description, extra) {
    return { type, severity, elem, elemLabel, prop, description, ...extra };
  }

  /**
   * Count direction reversals in a numeric timeline.
   * A reversal is when consecutive deltas change sign (value oscillates).
   */
  function countReversals(numeric) {
    let reversals = 0;
    for (let i = 2; i < numeric.length; i++) {
      const d1 = numeric[i - 1].val - numeric[i - 2].val;
      const d2 = numeric[i].val - numeric[i - 1].val;
      if (Math.abs(d1) > 0.01 && Math.abs(d2) > 0.01 && d1 * d2 < 0) {
        reversals++;
      }
    }
    return reversals;
  }

  // --- Detector functions ---

  /**
   * Sections 1+2: outlier properties and bounce scan.
   * Finds properties that change at unusual rates, then checks all props for bounce patterns.
   */
  function detectOutlierFindings(propStats, elements) {
    const findings = [];
    const outliers = detectOutliers(propStats);

    for (const outlier of outliers) {
      const timeline = getTimeline(outlier.elem, outlier.prop);
      const bounce = detectBounce(timeline);
      const label = elements[outlier.elem];

      if (bounce) {
        findings.push(makeFinding(
          'jitter',
          bounce.peakDeviation > 20 ? 'high' : bounce.peakDeviation > 5 ? 'medium' : 'low',
          outlier.elem, label, outlier.prop,
          `${outlier.prop} bounces from ${bounce.restValue} to ${bounce.peak} and back over ${bounce.duration}ms at t=${bounce.startT}ms`,
          { rawChanges: outlier.raw, medianForElement: outlier.median, bounce, timeline }
        ));
      } else {
        findings.push(makeFinding(
          'outlier', 'info', outlier.elem, label, outlier.prop,
          `${outlier.prop} changed ${outlier.raw}x while sibling props median is ${outlier.median}x`,
          { rawChanges: outlier.raw, medianForElement: outlier.median, timeline }
        ));
      }
    }

    // Scan ALL properties for bounce patterns (catches jitters even if not outliers)
    for (const p of propStats.props) {
      if (p.raw < 3) continue;
      if (findings.some((f) => f.elem === p.elem && f.prop === p.prop)) continue;

      const timeline = getTimeline(p.elem, p.prop);
      const bounce = detectBounce(timeline);
      if (bounce && bounce.peakDeviation > 1 && bounce.duration < 1000) {
        const isFlicker = p.prop === 'opacity';
        findings.push(makeFinding(
          isFlicker ? 'flicker' : 'jitter',
          bounce.peakDeviation > 20 ? 'high' : bounce.peakDeviation > 5 ? 'medium' : 'low',
          p.elem, elements[p.elem], p.prop,
          `${p.prop} bounces from ${bounce.restValue} to ${bounce.peak} and back over ${bounce.duration}ms at t=${bounce.startT}ms`,
          { rawChanges: p.raw, bounce, timeline }
        ));
      }
    }

    return findings;
  }

  /**
   * Section 3: detect oscillation/shiver — high-frequency direction reversals
   * indicating two forces fighting (e.g. scroll-to-bottom vs overscroll bounce).
   */
  function detectShiverFindings(propStats, elements, existingFindings) {
    const findings = [];

    for (const p of propStats.props) {
      if (p.raw < 10) continue;
      if (existingFindings.some((f) => f.elem === p.elem && f.prop === p.prop)) continue;

      const timeline = getTimeline(p.elem, p.prop);
      if (timeline.length < 10) continue;

      const numeric = [];
      for (const { t, value } of timeline) {
        const n = extractNumeric(value);
        if (n !== null) numeric.push({ t, val: n });
      }
      if (numeric.length < 10) continue;

      const reversals = countReversals(numeric);
      const reversalDensity = reversals / (numeric.length - 2);

      if (reversalDensity > 0.3 && reversals >= 5) {
        const uniqueVals = [...new Set(numeric.map((n) => Math.round(n.val * 10) / 10))];
        const isTwoValueFight = uniqueVals.length <= 4;

        const vals = numeric.map((n) => n.val);
        const amplitude = Math.round((Math.max(...vals) - Math.min(...vals)) * 10) / 10;
        const hz = Math.round((reversals / ((numeric[numeric.length - 1].t - numeric[0].t) / 1000)) * 10) / 10;

        findings.push(makeFinding(
          'shiver',
          reversalDensity > 0.7 ? 'high' : reversalDensity > 0.5 ? 'medium' : 'low',
          p.elem, elements[p.elem], p.prop,
          isTwoValueFight
            ? `${p.prop} oscillates between ${Math.min(...vals)} and ${Math.max(...vals)} at ${hz}Hz — two forces fighting (${Math.round(reversalDensity * 100)}% frames reverse)`
            : `${p.prop} shivers with ${reversals} direction reversals across ${numeric.length} frames (${Math.round(reversalDensity * 100)}% reversal rate, amplitude ${amplitude}, ${hz}Hz)`,
          {
            rawChanges: p.raw,
            shiver: {
              reversals,
              totalFrames: numeric.length,
              reversalDensity: Math.round(reversalDensity * 1000) / 1000,
              amplitude,
              hz,
              range: [Math.min(...vals), Math.max(...vals)],
              uniqueValues: uniqueVals.length,
              isTwoValueFight,
              durationMs: Math.round(numeric[numeric.length - 1].t - numeric[0].t),
            },
          }
        ));
      }
    }

    return findings;
  }

  /**
   * Section 4: detect sudden jumps — a single frame where a numeric property changes
   * by an amount far larger than the typical per-frame delta.
   */
  function detectJumpFindings(propStats, elements, existingFindings) {
    const findings = [];

    for (const p of propStats.props) {
      if (p.raw < 3) continue;
      if (existingFindings.some((f) => f.elem === p.elem && f.prop === p.prop)) continue;

      const timeline = getTimeline(p.elem, p.prop);
      if (timeline.length < 3) continue;

      const deltas = [];
      for (let i = 1; i < timeline.length; i++) {
        const prev = extractNumeric(timeline[i - 1].value);
        const curr = extractNumeric(timeline[i].value);
        if (prev === null || curr === null) continue;
        deltas.push({
          t: timeline[i].t,
          delta: Math.abs(curr - prev),
          from: timeline[i - 1].value,
          to: timeline[i].value,
        });
      }

      if (deltas.length < 3) continue;

      const sortedDeltas = deltas.map((d) => d.delta).sort((a, b) => a - b);
      const medianDelta = sortedDeltas[Math.floor(sortedDeltas.length / 2)];
      if (medianDelta === 0) continue;

      for (const d of deltas) {
        if (d.delta > medianDelta * 10 && d.delta > 50) {
          findings.push(makeFinding(
            'jump',
            d.delta > medianDelta * 50 ? 'high' : d.delta > medianDelta * 20 ? 'medium' : 'low',
            p.elem, elements[p.elem], p.prop,
            `${p.prop} jumps from ${d.from} to ${d.to} at t=${d.t}ms (${Math.round(d.delta)}px, typical step is ${Math.round(medianDelta * 10) / 10}px)`,
            {
              rawChanges: p.raw,
              jump: {
                t: d.t,
                from: d.from,
                to: d.to,
                magnitude: Math.round(d.delta),
                medianDelta: Math.round(medianDelta * 10) / 10,
                ratio: Math.round(d.delta / medianDelta),
              },
            }
          ));
        }
      }
    }

    return findings;
  }

  /**
   * Section 5: deduplicate shivers — when many elements shiver at the same Hz on the
   * same property, it's a single root-cause event. Group them and report the scroll
   * container (or first element) with an affectedElements count.
   */
  function deduplicateShivers(findings) {
    const shiverFindings = findings.filter((f) => f.type === 'shiver');
    const otherFindings = findings.filter((f) => f.type !== 'shiver');

    const shiverGroups = new Map();
    for (const f of shiverFindings) {
      const key = `${f.prop}|${f.shiver.hz}|${f.shiver.isTwoValueFight}`;
      if (!shiverGroups.has(key)) shiverGroups.set(key, []);
      shiverGroups.get(key).push(f);
    }

    const deduped = [];
    for (const group of shiverGroups.values()) {
      if (group.length === 1) {
        deduped.push(group[0]);
      } else {
        group.sort((a, b) => b.shiver.amplitude - a.shiver.amplitude);
        const rep = { ...group[0] };
        rep.affectedElements = group.length;
        rep.description += ` (affects ${group.length} elements)`;
        deduped.push(rep);
      }
    }

    return [...otherFindings, ...deduped];
  }

  /**
   * Build findings: auto-detected anomalies in the recording.
   * Orchestrates individual detectors and merges results.
   */
  function analyzeFindings() {
    const propStats = buildPropStats();
    const elements = buildElementMap();

    let findings = detectOutlierFindings(propStats, elements);
    findings = findings.concat(detectShiverFindings(propStats, elements, findings));
    findings = findings.concat(detectJumpFindings(propStats, elements, findings));
    findings = deduplicateShivers(findings);

    // Sort by severity
    const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
    findings.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

    return findings;
  }

  // --- YAML formatter ---

  function toYAML(val, indent) {
    const pad = '  '.repeat(indent);
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean' || typeof val === 'number') return String(val);
    if (typeof val === 'string') return val.includes('\n') || val.includes(':') || val.includes('#') ? `"${val}"` : val;
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      // Compact array of primitives on one line
      if (val.every(v => v === null || typeof v !== 'object')) return `[${val.join(', ')}]`;
      return '\n' + val.map(item => `${pad}- ${toYAML(item, indent + 1).trimStart()}`).join('\n');
    }
    if (typeof val === 'object') {
      const entries = Object.entries(val);
      if (entries.length === 0) return '{}';
      return '\n' + entries.map(([k, v]) => {
        const formatted = toYAML(v, indent + 1);
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) return `${pad}${k}:${formatted}`;
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return `${pad}${k}:${formatted}`;
        return `${pad}${k}: ${formatted}`;
      }).join('\n');
    }
    return String(val);
  }

  // --- Public API ---

  window.dejitter = {
    configure(opts = {}) {
      config = { ...DEFAULT_CONFIG, ...opts };
      return config;
    },

    start() {
      rawFrames = [];
      mutations = [];
      lastSeen = new Map();
      nextElemId = 0;
      recording = true;
      startTime = performance.now();
      lastChangeTime = performance.now();
      hasSeenChange = false;

      startMutationObserver();
      rafId = requestAnimationFrame(loop);

      if (config.maxDuration > 0) {
        stopTimer = setTimeout(() => this.stop(), config.maxDuration);
      }
      return `Recording (outputRate=${config.sampleRate}/s, max=${config.maxDuration}ms, idle=${config.idleTimeout}ms, props=[${config.props}], mutations=${config.mutations})`;
    },

    stop() {
      recording = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (stopTimer) clearTimeout(stopTimer);
      mutationObserver?.disconnect();

      const msg = `Stopped. ${rawFrames.length} raw frames, ${mutations.length} mutation events.`;
      console.log(`[dejitter:stopped] ${msg}`);

      for (const cb of onStopCallbacks) {
        try { cb(); } catch (e) { console.error('[dejitter] onStop callback error:', e); }
      }

      return msg;
    },

    onStop(callback) {
      onStopCallbacks.push(callback);
    },

    getData() {
      const samples = downsample();
      const elements = buildElementMap();
      const propStats = buildPropStats();

      return {
        config: { ...config },
        duration: rawFrames.length ? rawFrames[rawFrames.length - 1].t : 0,
        rawFrameCount: rawFrames.length,
        outputFrameCount: samples.length,
        mutationEvents: mutations.length,
        propStats,
        elements,
        samples,
        mutations,
      };
    },

    /** Quick summary. Returns YAML string by default, pass true for raw object. */
    summary(json) {
      const propStats = buildPropStats();
      const elements = buildElementMap();
      const byMode = { anomaly: 0, sampled: 0, dropped: 0 };
      for (const p of propStats.props) {
        byMode[p.mode] = (byMode[p.mode] || 0) + 1;
      }
      const data = {
        duration: rawFrames.length ? rawFrames[rawFrames.length - 1].t : 0,
        rawFrameCount: rawFrames.length,
        targetOutputFrames: propStats.targetFrames,
        mutationEvents: mutations.length,
        elementsTracked: Object.keys(elements).length,
        propBreakdown: byMode,
      };
      return json ? data : toYAML(data, 0);
    },

    /** Auto-detect anomalies. Returns YAML string by default, pass true for raw array. */
    findings(json) {
      const data = analyzeFindings().map(({ timeline, ...rest }) => rest);
      return json ? data : toYAML(data, 0);
    },

    /** Access raw unprocessed frames (for debugging the recorder itself) */
    getRaw() {
      return { rawFrames, mutations };
    },

    toJSON() {
      return JSON.stringify(this.getData(), null, 2);
    },
  };

  // --- Floating UI ---

  function injectUI() {
    const el = document.createElement('div');
    el.id = '__dj_ui';
    el.innerHTML = `
      <style>
        #__dj_ui {
          position: fixed;
          top: 12px;
          right: 12px;
          z-index: 999999;
          font: 12px/1.4 system-ui, sans-serif;
          pointer-events: none;
        }
        #__dj_ui * { pointer-events: auto; }
        #__dj_btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border: none;
          border-radius: 20px;
          background: #1a1a1a;
          color: #fff;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          transition: background 0.15s;
        }
        #__dj_btn:hover { background: #333; }
        #__dj_btn[data-recording="true"] { background: #c0392b; }
        #__dj_btn[data-recording="true"]:hover { background: #e74c3c; }
        #__dj_dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #888;
        }
        #__dj_btn[data-recording="true"] #__dj_dot {
          background: #fff;
          animation: __dj_pulse 1s ease-in-out infinite;
        }
        @keyframes __dj_pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        #__dj_status {
          margin-top: 4px;
          padding: 4px 10px;
          border-radius: 8px;
          background: rgba(0,0,0,0.75);
          color: #ccc;
          font-size: 11px;
          display: none;
          max-width: 260px;
        }
        #__dj_status.visible { display: block; }
      </style>
      <button id="__dj_btn" data-recording="false">
        <span id="__dj_dot"></span>
        <span id="__dj_label">Record</span>
      </button>
      <div id="__dj_status"></div>
    `;
    document.body.appendChild(el);

    const btn = document.getElementById('__dj_btn');
    const label = document.getElementById('__dj_label');
    const status = document.getElementById('__dj_status');

    let timer = null;

    function showStatus(text, duration) {
      status.textContent = text;
      status.classList.add('visible');
      clearTimeout(timer);
      if (duration) timer = setTimeout(() => status.classList.remove('visible'), duration);
    }

    // Register stop callback to update UI
    dejitter.onStop(() => {
      btn.dataset.recording = 'false';
      label.textContent = 'Record';

      const f = analyzeFindings().map(({ timeline, ...rest }) => rest);
      const high = f.filter(x => x.severity === 'high').length;
      const med = f.filter(x => x.severity === 'medium').length;
      const low = f.filter(x => x.severity === 'low').length;
      const parts = [];
      if (high) parts.push(`${high} high`);
      if (med) parts.push(`${med} med`);
      if (low) parts.push(`${low} low`);
      const findingsText = parts.length ? parts.join(', ') : 'no anomalies';

      showStatus(`${rawFrames.length} frames · ${findingsText}`, 8000);
    });

    btn.addEventListener('click', () => {
      if (btn.dataset.recording === 'false') {
        dejitter.start();
        btn.dataset.recording = 'true';
        label.textContent = 'Stop';
        showStatus('Recording...', 0);
      } else {
        dejitter.stop();
      }
    });
  }

  // Inject after DOM ready
  if (document.body) {
    injectUI();
  } else {
    document.addEventListener('DOMContentLoaded', injectUI);
  }
})();
