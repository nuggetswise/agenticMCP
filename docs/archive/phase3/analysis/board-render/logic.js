// Verbatim logic of project/AgentLive.dc.html on the approved board (canvas N5zQWtnMqqFhg2b7x93d3F), for local rendering only.
class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = { tick: 0, phase: 'reading', editing: false, order: 'carton', drawer: false, replan: 0 };
    this.timers = [];
  }
  componentDidMount() {
    var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rm) { this.setState({ tick: 12, phase: 'proposal' }); return; }
    var self = this;
    this.iv = setInterval(function () {
      var t = self.state.tick + 1;
      if (t >= 12) { clearInterval(self.iv); self.setState({ tick: 12, phase: 'proposal' }); }
      else self.setState({ tick: t });
    }, 650);
  }
  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }
  renderVals() {
    var s = this.state, self = this;
    var ph = s.phase, tick = s.tick;
    var done = ph !== 'reading';
    var chip = function (kind) {
      var base = 'padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; ';
      if (kind === 'work') return base + 'background: #E8F0FF; color: var(--ot-blue-900)';
      if (kind === 'wait') return base + 'background: var(--ot-warn-tint); color: var(--ot-warn)';
      if (kind === 'done') return base + 'background: var(--ot-navy-900); color: var(--ot-white)';
      return base + 'background: var(--ot-line-200); color: var(--ot-slate-700)';
    };
    var data = [
      ['NR-460207', '659 of 660 cartons loaded. Supplier ERP says DC 4; the order says DC 2.', 'DC 2 can’t check the load in by scan, and Northfield charges 3 violations.', 'Trailer seals in about 40 minutes', true],
      ['NR-460219', 'The invoice draft bills 180 units; 176 shipped.', 'Northfield disputes the invoice and charges $100, and payment slows.', 'Invoice batch sends in 2 hours 48 minutes', false],
      ['NR-460241', 'The routing request is missing.', 'Pickup is booked late, delivery slips, and Northfield charges $150.', 'Routing request due in 17 hours', false],
      ['NR-460262', '520 units available for 640 ordered across 3 orders.', 'Northfield’s order ships short, with an in-full penalty of about $48.60.', 'Kinross change cutoff in 20 hours', false],
      ['NR-460233', '12 carton labels reuse SSCC numbers.', 'DC 2 scanners reject those cartons, and Northfield charges $162.', 'Loading starts in 22 hours', false],
      ['NR-460274', '270 cases agreed by phone; the PO reads 300.', 'Shipping 270 counts as 30 short against the order Northfield holds.', 'Loading starts in 24 hours', false]
    ];
    var rows = [];
    data.forEach(function (d, i) {
      if (tick < i + 1) return;
      var c, k;
      if (!done) { c = 'Checking'; k = 'work'; }
      else if (i === 0) {
        if (ph === 'done') { c = 'Receipt matched'; k = 'done'; }
        else if (ph === 'sent1' || ph === 'sent2') { c = 'Sent'; k = 'muted'; }
        else if (ph === 'replan') { c = 'Re-planning'; k = 'work'; }
        else { c = 'Ready for review'; k = 'wait'; }
      }
      else if (i === 3) { c = 'Needs your answer'; k = 'wait'; }
      else { c = 'Ready for review'; k = 'wait'; }
      var open = i === 0;
      rows.push({
        id: d[0], wrong: d[1], impact: d[2], cut: d[3], chip: c, chipStyle: chip(k),
        cutColor: d[4] ? 'var(--ot-risk)' : 'var(--text-muted)',
        box: 'display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: var(--surface-card); border-radius: 12px; border: ' + (open ? '2px solid var(--ot-blue-500)' : '1px solid var(--border-default)')
      });
    });
    var steps1 = [
      ['Kinross load scan arrived: 659 of 660 cartons loaded, carton ending 5172 staged at door 7', 'Kinross · API'],
      ['Read Northfield’s order change 1: ship to DC 2', 'EDI 860'],
      ['Read the sales order: ship to DC 4', 'Supplier ERP'],
      ['Checked Northfield rules: the ship notice matches the load carton for carton, and the ship-to matches the current order', 'Northfield rules 2026.2'],
      ['Drafted 2 actions and an order of work', 'Scout Agent']
    ];
    var steps2 = [
      ['Read Kinross’s reply: carton ending 5172 crushed, cannot load before seal', 'Kinross · API'],
      ['Changed the plan: ship 659 cartons and take carton ending 5172 off the ship notice', 'Scout Agent']
    ];
    var steps = [];
    steps1.forEach(function (x, i) { if (tick >= 7 + i || done) steps.push({ text: x[0], tag: x[1] }); });
    var second = ph === 'replan' || ph === 'proposal2' || ph === 'sent2' || ph === 'done';
    if (second) steps2.forEach(function (x, i) { if (ph !== 'replan' || s.replan > i) steps.push({ text: x[0], tag: x[1] }); });
    var hasProblem = tick >= 10 || done;
    var problems = [{ text: 'Carton ending 5172 is staged, not loaded.' }, { text: 'Northfield moved the order to DC 2. The Supplier ERP still says DC 4.' }];
    if (second) problems = [{ text: 'Carton ending 5172 is crushed and cannot load before the seal.' }, { text: 'Ship-to now reads DC 2 in the Supplier ERP.' }];
    var stake = second ? 'If the ship notice says 660, it will not match what DC 2 receives.' : 'No decision before the trailer seals: the order ships 659 of 660 cartons.';
    var p1 = ph === 'proposal', p2 = ph === 'proposal2';
    var showProposal = p1 || p2;
    var actions = p1 ? [
      { action: 'Load carton ending 5172', now: '659 of 660', after: '660 of 660', to: 'Kinross', via: '· API' },
      { action: 'Change the ship-to', now: 'DC 4', after: 'DC 2', to: 'Supplier ERP', via: '' }
    ] : [
      { action: 'Take carton ending 5172 off the ship notice', now: '660 cartons', after: '659 cartons', to: 'Northfield', via: '· EDI 856' }
    ];
    var choices = [
      { key: 'carton', title: 'Carton first, then ship-to', note: 'Recommended under your rule: earliest cutoff first. The trailer seals in about 40 minutes.' },
      { key: 'order', title: 'Ship-to first, then carton', note: 'Fixes the Supplier ERP first; the carton may miss the seal.' }
    ].map(function (c) {
      var on = s.order === c.key;
      return {
        title: c.title, note: c.note,
        pick: function () { self.setState({ order: c.key }); },
        style: 'display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; text-align: left; font: inherit; cursor: pointer; background: ' + (on ? '#E8F0FF' : 'var(--ot-white)') + '; border-radius: 10px; border: ' + (on ? '2px solid var(--ot-blue-500)' : '1px solid var(--border-default)')
      };
    });
    var result = [];
    var dotDone = 'flex: 0 0 8px; height: 8px; border-radius: 999px; background: var(--ot-navy-900)';
    var dotNext = 'flex: 0 0 6px; height: 6px; border-radius: 999px; border: 2px solid var(--ot-slate-500)';
    var tDone = 'flex: 1; color: var(--text-heading)';
    var tNext = 'flex: 1; color: var(--text-muted)';
    var tEnd = 'flex: 1; font-weight: 700; color: var(--text-heading)';
    var after1 = ph === 'sent1' || second;
    var after2 = ph === 'sent2' || ph === 'done';
    if (after1) {
      result.push({ text: s.editedBy ? 'Edited and approved by Priya Raman: Kinross task delivered' : 'Approved by Priya Raman: Kinross task delivered', tag: 'Kinross · API', dot: dotDone, textStyle: tDone });
      result.push({ text: 'Ship-to changed to DC 2 in the Supplier ERP', tag: 'Supplier ERP', dot: dotDone, textStyle: tDone });
    }
    if (after2) result.push({ text: 'Ship notice for 659 cartons delivered to Northfield', tag: 'EDI 856', dot: dotDone, textStyle: tDone });
    if (ph === 'done') result.push({ text: 'Northfield’s receiving advice matches the ship notice: 659 cartons at DC 2', tag: 'EDI 861', dot: dotDone, textStyle: tEnd });
    else result.push({ text: 'Northfield’s receiving advice matches the ship notice', tag: 'EDI 861', dot: dotNext, textStyle: tNext });
    return {
      subtitle: done ? 'Scout Agent started when the Kinross load scan arrived, checked 124 shipments and found 6 at risk. Nothing goes to Northfield or Kinross until you approve.' : 'Kinross load scan arrived. Scout Agent is checking Northfield shipments…',
      queueLabel: done ? 'Needs review · 6 orders' : 'Scout Agent checking',
      rows: rows, steps: steps, hasProblem: hasProblem, problems: problems, stake: stake,
      workChip: (ph === 'reading' || ph === 'replan') ? 'Working' : 'Done',
      workChipStyle: chip((ph === 'reading' || ph === 'replan') ? 'work' : 'muted'),
      showProposal: showProposal, showJudgment: p1, choices: choices, actions: actions,
      editing: s.editing && p1, notEditing: !(s.editing && p1), canEdit: p1 && !s.editing,
      reason: p1 ? 'Northfield’s order change 1 says DC 2, and the trailer is not sealed yet.' : 'Northfield matches the ship notice to the load carton for carton.',
      approveLine: p1 ? (s.editing ? 'Your edit: approve sends 1 task to Kinross and changes 1 field in the Supplier ERP. Nothing goes to Northfield.' : 'Approve sends 1 task to Kinross and changes 1 field in the Supplier ERP. Nothing goes to Northfield.') : 'Approve releases the ship notice, built from the load scan: 659 cartons to Northfield.',
      noDecision: p1 ? 'No decision before the trailer seals: the order ships 659 of 660 cartons.' : 'No decision: the trailer leaves without a ship notice.',
      result: result, drawer: s.drawer,
      toggleDrawer: function () { self.setState({ drawer: !s.drawer }); },
      edit: function () { self.setState({ editing: true }); },
      approve: function () {
        if (p1) {
          self.setState({ phase: 'sent1', editedBy: s.editing, editing: false });
          self.later(1400, function () { self.setState({ phase: 'replan', replan: 0 }); });
          self.later(2100, function () { self.setState({ replan: 1 }); });
          self.later(2800, function () { self.setState({ replan: 2 }); });
          self.later(3400, function () { self.setState({ phase: 'proposal2' }); });
        } else if (p2) {
          self.setState({ phase: 'sent2' });
          self.later(1500, function () { self.setState({ phase: 'done' }); });
        }
      }
    };
  }
}
