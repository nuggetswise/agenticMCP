/* Money in Motion engine, copied from the live P8 page, version 1794576266-f6d7, for docs/phase0/walks/P8/definitions-check.mjs. Evidence only: the page is the owner of this code. */
(function (root) {
  "use strict";
  var BK = ["ord", "con", "tra", "rec", "inv"];
  var WIN = [30, 60, 90];
  function winOf(d) { return d <= WIN[0] ? 0 : d <= WIN[1] ? 1 : d <= WIN[2] ? 2 : 3; }
  function lineState(po, ln, sup, T) {
    var O = ln.q, ack = null, asn = {}, inv = {}, closed = false, closeDay = null;
    for (var i = 0; i < po.ev.length; i++) {
      var e = po.ev[i]; if (e[1] > T) continue;
      var t = e[0], q;
      if (t === "chg") { if (ln.k in e[2]) O = e[2][ln.k]; }
      else if (t === "ack") { var a = e[2][ln.k]; if (a) ack = { q: a[0], code: a[1], bo: a[2] || 0, day: e[1] }; }
      else if (t === "asn") { q = e[3][ln.k]; if (q != null) asn[e[2]] = { S: q, day: e[1], R: null, rday: null }; if (e[4]) { closed = true; closeDay = e[1]; } }
      else if (t === "rcv") { q = e[3][ln.k]; if (q != null && asn[e[2]]) { asn[e[2]].R = q; asn[e[2]].rday = e[1]; } }
      else if (t === "inv") { inv[e[2]] = { q: e[3][ln.k] || 0, day: e[1], paid: false }; }
      else if (t === "pay") { if (inv[e[2]]) inv[e[2]].paid = true; }
    }
    var C = ack ? ack.q : O;
    var Sr = 0, Rm = 0, Su = 0, lastR = null, lastAu = null, k, allRcv = true, nAsn = 0;
    for (k in asn) {
      var s = asn[k]; nAsn++;
      if (s.R != null) { Sr += s.S; Rm += Math.min(s.R, s.S); lastR = lastR == null ? s.rday : Math.max(lastR, s.rday); }
      else { Su += s.S; allRcv = false; lastAu = lastAu == null ? s.day : Math.max(lastAu, s.day); }
    }
    var S = Sr + Su, Iu = 0, Ip = 0, lastI = null;
    for (k in inv) { if (inv[k].paid) Ip += inv[k].q; else { Iu += inv[k].q; lastI = lastI == null ? inv[k].day : Math.max(lastI, inv[k].day); } }
    var dsd = !!sup.dsd, Pq, tra;
    if (dsd) { Pq = Math.min(Ip, S); tra = S - Pq; } else { Pq = Math.min(Ip, Rm); tra = Su; }
    var recAvail = dsd ? 0 : Rm - Pq;
    var invq = dsd ? 0 : Math.min(Iu, recAvail);
    var rec = recAvail - invq;
    var over = dsd ? 0 : Math.max(Iu - recAvail - Su, 0);
    var ahead = dsd ? Math.min(Iu, tra) : Math.min(Math.max(Iu - recAvail, 0), Su);
    var g1 = ack ? Math.max(O - C, 0) : 0;
    var rem = Math.max(C - S, 0);
    var g2 = closed ? rem : 0, open = closed ? 0 : rem;
    var g3 = dsd ? 0 : Sr - Rm;
    var terms = sup.terms;
    var dueRec = (lastR == null ? T : lastR) + terms;
    var dueTra = dsd ? ((lastI != null ? lastI : (lastAu == null ? T : lastAu) + 3) + terms)
      : (Math.max((lastAu == null ? T : lastAu) + sup.transit, T + 1) + terms);
    var dueOpen = Math.max(po.d0 + sup.lead, T + 1) + sup.transit + terms;
    return {
      O: O, C: C, S: S, Sr: Sr, Rm: Rm, Su: Su, Iu: Iu, Ip: Ip, Pq: Pq, ack: ack, closed: closed, closeDay: closeDay,
      q: { ord: ack ? 0 : open, con: ack ? open : 0, tra: tra, rec: rec, inv: invq },
      g1: g1, g2: g2, g3: g3, over: over, ahead: ahead, lastR: lastR, allRcv: allRcv && nAsn > 0, nAsn: nAsn,
      due: { ord: dueOpen, con: dueOpen, tra: dueTra, rec: dueRec, inv: dueRec },
      measured: { ord: false, con: false, tra: dsd && lastI != null, rec: true, inv: true }
    };
  }

  function compute(fx, T) {
    var out = {
      T: T, buckets: { ord: 0, con: 0, tra: 0, rec: 0, inv: 0 }, rows: [], total: 0,
      gaps: { g1: [], g2: [], g3: [], g4: [] }, gapTotals: { g1: 0, g2: 0, g3: 0, g4: 0 },
      openValue: 0, unfilled: 0, openPOs: 0, cancelled: 0, cancelledPOs: 0, paid: 0,
      due: [0, 1, 2, 3].map(function () { return { ord: 0, con: 0, tra: 0, rec: 0, inv: 0, t: 0 }; }),
      measured: 0, estimated: 0, flags: { ahead: 0, noRcv: 0, noAck: 0, back: 0, withinTol: 0 },
      health: {}, cover: {}, rcv30: 0, violations: []
    };
    var h = { ackN: 0, ackOn: 0, conC: 0, conO: 0, sfS: 0, sfC: 0, rmR: 0, rmS: 0, imN: 0, imOk: 0 };
    var ackSup = {}, supSeen = {};
    fx.pos.forEach(function (po, pi) {
      var sup = fx.sup[po.s]; supSeen[po.s] = 1;
      var st = po.lines.map(function (ln) { return lineState(po, ln, sup, T); });
      if (po.d0 > T) return;
      var Osum = 0; st.forEach(function (x) { Osum += x.O; });
      if (Osum === 0) { out.cancelledPOs++; po.lines.forEach(function (ln) { out.cancelled += ln.q * ln.p; }); return; }
      if (po.d0 <= T - 1 && po.d0 >= T - 30) { h.ackN++; var a0 = st[0].ack; if (a0 && a0.day <= po.d0 + 1) h.ackOn++; }
      if (st[0].ack && st[0].ack.day >= T - 60) ackSup[po.s] = 1;
      var open = false, poRows = [], poGap = { g1: 0, g2: 0, g3: 0, g4: 0 }, paidV = 0, ordV = 0, conV = 0, back = 0, shipV = 0, iuV = 0, raV = 0;
      st.forEach(function (x, li) {
        var p = po.lines[li].p;
        if (x.S > x.C) out.violations.push(po.id + " shipped above confirmed");
        BK.forEach(function (b) { if (x.q[b] > 0) { open = true; poRows.push({ po: pi, b: b, v: x.q[b] * p, due: x.due[b] - T, m: x.measured[b], ahead: b === "tra" ? x.ahead * p : 0, back: b === "con" && x.ack && x.ack.code === "IB" ? Math.min(x.ack.bo, x.q.con) * p : 0 }); } });
        poGap.g1 += x.g1 * p; poGap.g2 += x.g2 * p; poGap.g3 += x.g3 * p;
        var overV = x.over * p; if (overV * 1000 > x.Iu * p * 5) poGap.g4 += overV; else out.flags.withinTol += overV;
        paidV += x.Pq * p; ordV += x.O * p; conV += x.C * p; shipV += x.S * p; if (x.over > 0) { iuV += x.Iu * p; raV += (x.Rm - x.Pq) * p; }
        if (x.ack && x.ack.code === "IB" && x.q.con > 0) back += Math.min(x.ack.bo, x.q.con) * p;
        if (x.closed && x.closeDay > T - 30) { h.sfS += Math.min(x.S, x.C) * p; h.sfC += x.C * p; }
        if (x.lastR != null && x.lastR > T - 30) { h.rmR += x.Rm * p; h.rmS += x.Sr * p; out.rcv30 += x.Rm * p; }
        if (x.Iu > 0 && !sup.dsd && x.Su === 0) { h.imN++; if (!(overV * 1000 > x.Iu * p * 5)) h.imOk++; }
      });
      out.paid += paidV;
      if (!open) return;
      out.openPOs++; out.openValue += ordV - paidV;
      if (st[0].ack) { h.conC += conV; h.conO += ordV; }
      poRows.forEach(function (r) {
        out.rows.push(r); out.buckets[r.b] += r.v; out.total += r.v;
        var w = winOf(r.due); out.due[w][r.b] += r.v; out.due[w].t += r.v;
        if (r.m) out.measured += r.v; else out.estimated += r.v;
        if (r.ahead) out.flags.ahead += r.ahead;
        if (r.b === "tra" && sup.dsd) out.flags.noRcv += r.v;
        if (r.b === "ord" && !sup.ack) out.flags.noAck += r.v;
      });
      out.flags.back += back;
      ["g1", "g2", "g3", "g4"].forEach(function (g) {
        if (poGap[g] > 0) { out.gaps[g].push({ po: pi, v: poGap[g], ord: ordV, con: conV, ship: shipV, iu: iuV, ra: raV }); out.gapTotals[g] += poGap[g]; }
      });
      out.unfilled += poGap.g1 + poGap.g2 + poGap.g3;
    });
    out.health = {
      ackOnTime: h.ackN ? h.ackOn / h.ackN : null, confirm: h.conO ? h.conC / h.conO : null,
      shipFull: h.sfC ? h.sfS / h.sfC : null, rcvMatch: h.rmS ? h.rmR / h.rmS : null, invMatch: h.imN ? h.imOk / h.imN : null
    };
    out.cover = {
      supN: Object.keys(supSeen).length, ackSup: Object.keys(ackSup).length,
      dsdSup: fx.sup.filter(function (s, i) { return s.dsd && supSeen[i]; }).length
    };
    return out;
  }

  /* One order's value chain at day T. */
  function chain(fx, id, T) {
    var po = fx.pos.filter(function (p) { return p.id === id; })[0], sup = fx.sup[po.s];
    var r = { ordered: 0, accepted: 0, shipped: 0, received: 0, invoicedOpen: 0, buckets: { ord: 0, con: 0, tra: 0, rec: 0, inv: 0 },
      g1: 0, g2: 0, g3: 0, over: 0, ahead: 0, paid: 0, deduction: 0, reversal: 0 };
    po.lines.forEach(function (ln) {
      var x = lineState(po, ln, sup, T), p = ln.p;
      r.ordered += x.O * p; r.accepted += x.C * p; r.shipped += x.S * p; r.received += x.Rm * p; r.invoicedOpen += x.Iu * p;
      BK.forEach(function (b) { r.buckets[b] += x.q[b] * p; });
      r.g1 += x.g1 * p; r.g2 += x.g2 * p; r.g3 += x.g3 * p; r.over += x.over * p; r.ahead += x.ahead * p;
    });
    po.ev.forEach(function (e) {
      if (e[1] > T) return;
      if (e[0] === "pay") { r.paid += e[3]; r.deduction += e[4] || 0; }
      if (e[0] === "rev") r.reversal += e[2];
    });
    r.netPaid = r.paid + r.reversal; r.openDeduction = r.deduction - r.reversal;
    return r;
  }

  /* Replay a release rule on orders acknowledged in the last `days` days and closed by T.
     variant "A": release reduced and rejected quantities at acknowledgment.
     variant "B": also release backordered quantities. Baseline: release when the order closes. */
  function replay(fx, T, variant, days) {
    var r = { orders: 0, released: 0, dayValue: 0, recommit: 0, recommitOrders: 0, baseline: 0, considered: 0 };
    fx.pos.forEach(function (po) {
      var sup = fx.sup[po.s], rel = 0, rc = 0, base = 0, ackDay = null, close = null, done = true, any = false;
      po.lines.forEach(function (ln) {
        var x = lineState(po, ln, sup, T), p = ln.p;
        if (!x.ack || x.O === 0) { done = false; return; }
        any = true; ackDay = x.ack.day;
        if (!x.closed || (!sup.dsd && !x.allRcv)) done = false;
        var c = sup.dsd ? x.closeDay : x.lastR; if (c != null) close = close == null ? c : Math.max(close, c);
        base += (x.g1 + x.g2) * p;
        if (x.ack.code === "IQ" || x.ack.code === "IR") rel += x.g1 * p;
        if (variant === "B" && x.ack.code === "IB") {
          rel += x.ack.bo * p;
          rc += Math.min(x.ack.bo, Math.max(x.S - (x.C - x.ack.bo), 0)) * p;
        }
      });
      if (!any || !done || ackDay == null || ackDay < T - days || close == null) return;
      r.considered++;
      r.baseline += base;
      if (rel > 0) { r.orders++; r.released += rel; r.dayValue += rel * Math.max(close - ackDay, 0); }
      if (rc > 0) { r.recommit += rc; r.recommitOrders++; }
    });
    r.daysEarlier = r.released ? r.dayValue / r.released : 0;
    return r;
  }

  var api = { compute: compute, chain: chain, replay: replay, lineState: lineState, BK: BK, winOf: winOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MIM = api;
})(typeof window !== "undefined" ? window : this);
