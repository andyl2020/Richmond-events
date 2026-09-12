/* =============================================================
   recurrence.js — date helpers + recurrence expansion
   No dependencies. All dates are handled as plain local
   calendar dates ("YYYY-MM-DD") so nothing shifts across
   timezones or DST boundaries.
   ============================================================= */
(function (global) {
  'use strict';

  var DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ORDINALS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' };

  /* ---------- core date utils (all operate on local dates) ---------- */

  // "2026-09-20" -> Date at local noon (noon avoids DST edge cases)
  function parseISO(iso) {
    if (!iso) return null;
    var m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
  }

  function toISO(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
  }

  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }

  function addMonths(d, n) {
    var c = new Date(d.getFullYear(), d.getMonth() + n, 1, 12, 0, 0, 0);
    return c;
  }

  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  function sameDay(a, b) { return toISO(a) === toISO(b); }

  function diffDays(a, b) {
    return Math.round((parseISO(toISO(b)) - parseISO(toISO(a))) / 86400000);
  }

  /* ---------- formatting ---------- */

  // "19:00" -> "7:00 PM";  "19:30" -> "7:30 PM"
  function formatTime(t) {
    if (!t) return '';
    var m = String(t).trim().match(/^(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?$/);
    if (!m) return String(t);
    var h = +m[1], min = m[2] ? +m[2] : 0, mer = m[3] ? m[3].toLowerCase() : null;
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (min ? ':' + String(min).padStart(2, '0') : ':00') + ' ' + suffix;
  }

  function formatTimeRange(start, end) {
    if (!start && !end) return 'Time TBC';
    if (!end) return formatTime(start);
    return formatTime(start) + ' – ' + formatTime(end);
  }

  function formatDate(d, style) {
    if (typeof d === 'string') d = parseISO(d);
    if (!d) return '';
    switch (style) {
      case 'long':   return DAY_NAMES[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      case 'medium': return DAY_SHORT[d.getDay()] + ', ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
      case 'short':  return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
      case 'month':  return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      default:       return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  }

  // "Today" / "Tomorrow" / "In 4 days" / "Sat, Oct 3"
  function relativeDay(iso) {
    var n = diffDays(today(), parseISO(iso));
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n > 1 && n < 7) return 'In ' + n + ' days';
    if (n === -1) return 'Yesterday';
    if (n < 0) return formatDate(iso, 'medium');
    return formatDate(iso, 'medium');
  }

  /* ---------- recurrence ---------- */

  function dayCodeToIndex(code) {
    var i = DAY_CODES.indexOf(String(code).toUpperCase().slice(0, 2));
    if (i >= 0) return i;
    // tolerate full / short names: "Tuesday", "Tue", "tue"
    var s = String(code).toLowerCase();
    for (var j = 0; j < DAY_NAMES.length; j++) {
      if (DAY_NAMES[j].toLowerCase().indexOf(s) === 0 || s.indexOf(DAY_NAMES[j].toLowerCase()) === 0) return j;
    }
    return -1;
  }

  function normaliseByDay(byDay) {
    if (!byDay) return [];
    var arr = Array.isArray(byDay) ? byDay : [byDay];
    return arr.map(dayCodeToIndex).filter(function (i) { return i >= 0; });
  }

  /**
   * Expand a recurrence rule into ISO date strings inside [from, to].
   * Supported rules:
   *   { freq:'daily',   interval?, from?, until?, exceptions?[] }
   *   { freq:'weekly',  byDay:['TU'], interval?, from?, until?, exceptions?[] }
   *   { freq:'monthly', byDay:['TU'], nth:[1,3] }     // 1st & 3rd Tuesday; -1 = last
   *   { freq:'monthly', byMonthDay:[15] }             // the 15th of each month
   */
  function expandRecurrence(rule, from, to) {
    if (!rule) return [];
    var out = [];
    var freq = String(rule.freq || rule.frequency || 'weekly').toLowerCase();
    var interval = Math.max(1, +(rule.interval || 1));
    var exceptions = (rule.exceptions || rule.except || []).map(String);

    var windowStart = parseISO(from);
    var windowEnd = parseISO(to);
    var ruleStart = parseISO(rule.from || rule.startDate) || windowStart;
    var ruleEnd = parseISO(rule.until || rule.endDate) || windowEnd;

    var lo = ruleStart > windowStart ? ruleStart : windowStart;
    var hi = ruleEnd < windowEnd ? ruleEnd : windowEnd;
    if (lo > hi) return [];

    function push(d) {
      var iso = toISO(d);
      if (d < lo || d > hi) return;
      if (exceptions.indexOf(iso) !== -1) return;
      if (out.indexOf(iso) === -1) out.push(iso);
    }

    if (freq === 'daily') {
      var anchorD = parseISO(rule.from || rule.startDate) || lo;
      for (var d = new Date(lo.getTime()); d <= hi; d = addDays(d, 1)) {
        if (interval === 1 || Math.abs(diffDays(anchorD, d)) % interval === 0) push(d);
      }
      return out.sort();
    }

    if (freq === 'weekly' || freq === 'biweekly' || freq === 'fortnightly') {
      if (freq !== 'weekly' && interval === 1) interval = 2;
      var days = normaliseByDay(rule.byDay || rule.days);
      if (!days.length) days = [(parseISO(rule.from || rule.startDate) || lo).getDay()];
      var anchorW = parseISO(rule.from || rule.startDate) || lo;
      // anchor to the start of that week (Sunday) for interval maths
      var anchorWeek = addDays(anchorW, -anchorW.getDay());
      for (var w = new Date(lo.getTime()); w <= hi; w = addDays(w, 1)) {
        if (days.indexOf(w.getDay()) === -1) continue;
        if (interval > 1) {
          var weekIdx = Math.floor(diffDays(anchorWeek, addDays(w, -w.getDay())) / 7);
          if (((weekIdx % interval) + interval) % interval !== 0) continue;
        }
        push(w);
      }
      return out.sort();
    }

    if (freq === 'monthly') {
      var monthDays = rule.byMonthDay || rule.byMonthday || rule.monthDay;
      var nths = rule.nth || rule.bySetPos || rule.week;
      var mDays = normaliseByDay(rule.byDay || rule.days);
      var cursor = new Date(lo.getFullYear(), lo.getMonth(), 1, 12, 0, 0, 0);
      var guard = 0;
      while (cursor <= hi && guard++ < 480) {
        var y = cursor.getFullYear(), mo = cursor.getMonth();
        if (monthDays) {
          (Array.isArray(monthDays) ? monthDays : [monthDays]).forEach(function (md) {
            var dim = daysInMonth(y, mo);
            var dayNum = +md < 0 ? dim + 1 + +md : +md;
            if (dayNum >= 1 && dayNum <= dim) push(new Date(y, mo, dayNum, 12, 0, 0, 0));
          });
        } else if (mDays.length) {
          var positions = nths ? (Array.isArray(nths) ? nths : [nths]) : [1, 2, 3, 4, 5];
          mDays.forEach(function (dow) {
            positions.forEach(function (n) {
              var date = nthWeekdayOfMonth(y, mo, dow, +n);
              if (date) push(date);
            });
          });
        }
        cursor = addMonths(cursor, interval);
      }
      return out.sort();
    }

    // Unknown frequency — nothing to expand.
    return out;
  }

  // nth === -1 means "last <dow> of the month"
  function nthWeekdayOfMonth(year, month, dow, nth) {
    var dim = daysInMonth(year, month);
    if (nth > 0) {
      var first = new Date(year, month, 1, 12, 0, 0, 0);
      var offset = (dow - first.getDay() + 7) % 7;
      var day = 1 + offset + (nth - 1) * 7;
      return day <= dim ? new Date(year, month, day, 12, 0, 0, 0) : null;
    }
    var last = new Date(year, month, dim, 12, 0, 0, 0);
    var back = (last.getDay() - dow + 7) % 7;
    var dayN = dim - back + (nth + 1) * 7;
    return dayN >= 1 ? new Date(year, month, dayN, 12, 0, 0, 0) : null;
  }

  /** Human-readable cadence, e.g. "Every Tuesday" / "1st & 3rd Thursday monthly". */
  function describeRecurrence(rule) {
    if (!rule) return '';
    if (rule.text) return rule.text;
    var freq = String(rule.freq || rule.frequency || 'weekly').toLowerCase();
    var interval = Math.max(1, +(rule.interval || 1));
    var days = normaliseByDay(rule.byDay || rule.days).map(function (i) { return DAY_NAMES[i]; });
    var list = joinList(days);

    if (freq === 'daily') return interval === 1 ? 'Every day' : 'Every ' + interval + ' days';

    if (freq === 'weekly' || freq === 'biweekly' || freq === 'fortnightly') {
      var every = (freq !== 'weekly' || interval === 2) ? 'Every other ' : (interval > 1 ? 'Every ' + ordinalNum(interval) + ' ' : 'Every ');
      return (list ? every + list : every.trim() + ' week').replace(/\s+/g, ' ').trim();
    }

    if (freq === 'monthly') {
      var md = rule.byMonthDay || rule.byMonthday || rule.monthDay;
      if (md) {
        var ds = (Array.isArray(md) ? md : [md]).map(function (n) { return +n < 0 ? 'last day' : ordinalNum(+n); });
        return joinList(ds) + ' of the month';
      }
      var nths = rule.nth || rule.bySetPos || rule.week;
      if (nths) {
        var ns = (Array.isArray(nths) ? nths : [nths]).map(function (n) {
          return +n === -1 ? 'last' : ordinalNum(+n);
        });
        return joinList(ns) + ' ' + (list || 'day') + ' of the month';
      }
      return 'Monthly';
    }
    return 'Recurring';
  }

  function ordinalNum(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function joinList(arr) {
    if (!arr || !arr.length) return '';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + ' & ' + arr[1];
    return arr.slice(0, -1).join(', ') + ' & ' + arr[arr.length - 1];
  }

  global.RE = {
    DAY_CODES: DAY_CODES, DAY_NAMES: DAY_NAMES, DAY_SHORT: DAY_SHORT,
    MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT, ORDINALS: ORDINALS,
    parseISO: parseISO, toISO: toISO, today: today, addDays: addDays, addMonths: addMonths,
    daysInMonth: daysInMonth, sameDay: sameDay, diffDays: diffDays,
    formatTime: formatTime, formatTimeRange: formatTimeRange, formatDate: formatDate,
    relativeDay: relativeDay, expandRecurrence: expandRecurrence,
    describeRecurrence: describeRecurrence, nthWeekdayOfMonth: nthWeekdayOfMonth,
    ordinalNum: ordinalNum, joinList: joinList
  };
})(window);
