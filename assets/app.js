/* =============================================================
   app.js — Richmond Events
   Loads data/events.json, normalises it into occurrences, and
   renders the list view, the calendar view, and the detail panel.
   ============================================================= */
(function () {
  'use strict';

  var R = window.RE;

  var state = {
    data: null,
    events: [],
    view: 'list',
    kind: 'all',
    category: 'all',
    query: '',
    calMonth: null,        // Date, first of the displayed month
    showPast: false,
    lastFocus: null
  };

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function mapUrl(venue) {
    if (!venue) return null;
    // "Venue not confirmed" / "Various locations" are placeholders, not addresses.
    if (/not confirmed|various locations/i.test(venue.name || '')) return null;
    var q = [venue.name, venue.address].filter(Boolean).join(', ');
    if (!q || !/\d|\bSt\b|\bRd\b|\bAve\b|Park|Centre|Center|Gallery|Theatre/i.test(q)) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  /** Minimal markdown: paragraphs, **bold**, *italic*, [text](url), "- " lists, "> " quotes. */
  function md(src) {
    if (!src) return '';
    var blocks = String(src).split(/\n{2,}/);
    return blocks.map(function (block) {
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
        return '<ul>' + lines.map(function (l) {
          return '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      if (lines.every(function (l) { return /^\s*>\s?/.test(l); })) {
        return '<blockquote class="p-quote">' +
          inline(lines.map(function (l) { return l.replace(/^\s*>\s?/, ''); }).join(' ')) +
          '</blockquote>';
      }
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }

  function inline(text) {
    return esc(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  /* ---------------------------------------------------------
     Normalising events into occurrences
     --------------------------------------------------------- */

  var EXPAND_FROM = '2026-01-01';
  var EXPAND_TO   = '2028-12-31';

  function normalise(raw) {
    return raw.map(function (ev) {
      var e = Object.assign({}, ev);
      e.occurrences = [];
      e.isSpan = !!e.span;
      e.spanDays = e.date && e.endDate ? R.diffDays(R.parseISO(e.date), R.parseISO(e.endDate)) + 1 : 1;
      // A "run" is a season or exhibition long enough that painting it on
      // every calendar cell would bury everything else. Short 2-3 day spans
      // stay on the grid where you'd expect to find them.
      e.isRun = e.isSpan && e.spanDays > 3;
      e.hasSchedule = true;

      if (e.kind === 'recurring') {
        var rule = e.recurrence || {};
        if (!rule.freq && !rule.frequency) {
          // schedule varies / unconfirmed — nothing to place on a calendar
          e.hasSchedule = false;
          e.cadence = rule.text || 'Schedule varies';
        } else {
          e.cadence = R.describeRecurrence(rule);
          var dates = R.expandRecurrence(rule, EXPAND_FROM, EXPAND_TO);
          e.occurrences = dates.map(function (d) {
            return { date: d, start: rule.start, end: rule.end, event: e };
          });
        }
        e.timeLabel = rule.start ? R.formatTimeRange(rule.start, rule.end) : '';
      } else {
        // dated
        if (e.performances && e.performances.length) {
          e.occurrences = e.performances.map(function (p) {
            return { date: p.date, start: p.start, end: p.end, label: p.label, event: e };
          });
        } else if (e.isRun) {
          e.occurrences = [{ date: e.date, start: e.time && e.time.start, end: e.time && e.time.end, event: e }];
        } else {
          var end = e.endDate || e.date;
          var cur = R.parseISO(e.date), stop = R.parseISO(end);
          var guard = 0;
          while (cur && stop && cur <= stop && guard++ < 400) {
            e.occurrences.push({
              date: R.toISO(cur),
              start: e.time && e.time.start,
              end: e.time && e.time.end,
              event: e
            });
            cur = R.addDays(cur, 1);
          }
        }
        e.timeLabel = timeLabelFor(e);
      }

      e.searchBlob = [
        e.title, e.summary, e.description, e.category, e.cost,
        e.venue && e.venue.name, e.venue && e.venue.address,
        (e.tags || []).join(' '), e.cadence, e.organizer
      ].filter(Boolean).join(' ').toLowerCase();

      return e;
    });
  }

  function timeLabelFor(e) {
    if (e.performances && e.performances.length) {
      var times = e.performances.map(function (p) { return R.formatTime(p.start); });
      var uniq = times.filter(function (t, i) { return times.indexOf(t) === i; });
      return uniq.length === 1 ? uniq[0] : uniq.join(' / ');
    }
    if (e.hoursNote) return e.hoursNote;
    if (!e.time) return e.unverified ? 'Time unconfirmed' : 'Time not listed';
    if (e.time.openEnded) return 'From ' + R.formatTime(e.time.start);
    return R.formatTimeRange(e.time.start, e.time.end);
  }

  function dateRangeLabel(e) {
    if (!e.endDate || e.endDate === e.date) return R.formatDate(e.date, 'long');
    return R.formatDate(e.date, 'short') + ' – ' + R.formatDate(e.endDate, 'default');
  }

  /* ---------------------------------------------------------
     Filtering
     --------------------------------------------------------- */

  function matches(e) {
    if (state.kind !== 'all' && e.kind !== state.kind) return false;
    if (state.category !== 'all' && e.category !== state.category) return false;
    if (state.query && e.searchBlob.indexOf(state.query) === -1) return false;
    return true;
  }

  function visibleEvents() { return state.events.filter(matches); }

  /* ---------------------------------------------------------
     Badges
     --------------------------------------------------------- */

  function badges(e, opts) {
    opts = opts || {};
    var out = [];
    if (opts.kind) {
      out.push(e.kind === 'recurring'
        ? '<span class="badge badge-recurring">Recurring</span>'
        : '<span class="badge badge-dated">Dated</span>');
    }
    if (e.category) out.push('<span class="badge badge-cat">' + esc(e.category) + '</span>');
    if (e.free) out.push('<span class="badge badge-free">Free</span>');
    else if (e.cost && e.cost !== 'Not listed') out.push('<span class="badge badge-price">' + esc(e.cost) + '</span>');
    if (e.unverified) out.push('<span class="badge badge-soon">Unconfirmed</span>');
    if (e.status === 'ended') out.push('<span class="badge">Season ended</span>');
    return out.join('');
  }

  var ARROW = '<span class="er-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></span>';

  /* ---------------------------------------------------------
     List view
     --------------------------------------------------------- */

  function renderList() {
    var evs = visibleEvents();
    var dated = evs.filter(function (e) { return e.kind === 'dated'; });
    var recurring = evs.filter(function (e) { return e.kind === 'recurring'; });

    var todayISO = R.toISO(R.today());
    var spans = dated.filter(function (e) { return e.isRun; })
      .filter(function (e) { return (e.endDate || e.date) >= todayISO || state.showPast; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    var singles = dated.filter(function (e) { return !e.isRun; });

    // Flatten single-day events into day buckets, one entry per event per day
    var byDay = {};
    var pastCount = 0;
    singles.forEach(function (e) {
      e.occurrences.forEach(function (occ) {
        if (occ.date < todayISO) { pastCount++; if (!state.showPast) return; }
        (byDay[occ.date] = byDay[occ.date] || []).push(occ);
      });
    });

    var days = Object.keys(byDay).sort();

    /* ---- stats strip ---- */
    var statsEl = $('#stats');
    var upcomingCount = days.reduce(function (n, d) { return n + byDay[d].length; }, 0);
    var nextDay = days.filter(function (d) { return d >= todayISO; })[0];
    var bits = [];
    bits.push('<span><b>' + dated.length + '</b> dated</span>');
    bits.push('<span><b>' + recurring.length + '</b> recurring</span>');
    if (nextDay) bits.push('<span>Next up <b>' + esc(R.relativeDay(nextDay)) + '</b></span>');
    if (pastCount) {
      bits.push('<span><button class="linky" id="toggle-past">' +
        (state.showPast ? 'Hide' : 'Show') + ' ' + pastCount + ' past ' +
        (pastCount === 1 ? 'event' : 'events') + '</button></span>');
    }
    statsEl.innerHTML = bits.join('');
    var tp = $('#toggle-past');
    if (tp) tp.addEventListener('click', function () { state.showPast = !state.showPast; renderList(); });

    /* ---- dated ---- */
    var html = '';

    if (spans.length) {
      html += '<div class="sub-head"><h3>Ongoing &amp; multi-day</h3>' +
        '<p>Runs, seasons and exhibitions rather than a single evening.</p></div>' +
        '<div class="day-events span-list">' +
        spans.map(function (e) { return spanRow(e); }).join('') +
        '</div>';
    }

    if (days.length) {
      if (spans.length) html += '<div class="sub-head sub-head-gap"><h3>By date</h3></div>';
      html += days.map(function (d) {
        var dt = R.parseISO(d);
        var isToday = d === todayISO;
        var isPast = d < todayISO;
        return '<div class="day-group' + (isPast ? ' is-past' : '') + '">' +
          '<div class="day-stamp' + (isToday ? ' is-today' : '') + '">' +
            '<span class="dow">' + R.DAY_SHORT[dt.getDay()] + '</span>' +
            '<span class="dnum">' + dt.getDate() + '</span>' +
            '<span class="mon">' + R.MONTHS_SHORT[dt.getMonth()] + ' ' + dt.getFullYear() + '</span>' +
            (isToday ? '<span class="today-tag">Today</span>' : '') +
          '</div>' +
          '<div class="day-events">' +
            byDay[d].map(function (occ) { return eventRow(occ); }).join('') +
          '</div>' +
        '</div>';
      }).join('');
    }

    $('#dated-list').innerHTML = html;
    $('#section-dated').hidden = !(spans.length || days.length);

    /* ---- recurring ---- */
    var active = recurring.filter(function (e) { return e.status !== 'ended'; });
    var ended = recurring.filter(function (e) { return e.status === 'ended'; });
    $('#recurring-list').innerHTML =
      active.map(recurringCard).join('') + ended.map(recurringCard).join('');
    $('#section-recurring').hidden = !recurring.length;

    $('#list-empty').hidden = !!(dated.length || recurring.length);

    bindCards();
  }

  function spanRow(e) {
    var range = R.formatDate(e.date, 'short') + ' – ' +
      R.formatDate(e.endDate || e.date, (R.parseISO(e.endDate || e.date).getFullYear() !== R.parseISO(e.date).getFullYear()) ? 'default' : 'short');
    return '<button class="event-row is-span" data-id="' + esc(e.id) + '">' +
      '<span class="er-main">' +
        '<span class="er-title">' + esc(e.title) +
          (e.flag ? '<span class="badge badge-soon">' + esc(e.flag) + '</span>' : '') +
        '</span>' +
        '<span class="er-meta">' +
          '<span class="er-time">' + esc(range) + '</span>' +
          (e.venue && e.venue.name ? '<span class="sep">·</span><span>' + esc(e.venue.name) + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="er-side">' + badges(e) + ARROW + '</span>' +
    '</button>';
  }

  function eventRow(occ) {
    var e = occ.event;
    var t = occ.start
      ? (e.time && e.time.openEnded ? 'From ' + R.formatTime(occ.start) : R.formatTimeRange(occ.start, occ.end))
      : (e.unverified ? 'Time unconfirmed' : 'Time not listed');
    return '<button class="event-row" data-id="' + esc(e.id) + '">' +
      '<span class="er-main">' +
        '<span class="er-title">' + esc(e.title) +
          (e.flag ? '<span class="badge badge-soon">' + esc(e.flag) + '</span>' : '') +
        '</span>' +
        '<span class="er-meta">' +
          '<span class="er-time">' + esc(t) + '</span>' +
          (e.venue && e.venue.name ? '<span class="sep">·</span><span>' + esc(e.venue.name) + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="er-side">' + badges(e) + ARROW + '</span>' +
    '</button>';
  }

  function recurringCard(e) {
    var next = nextOccurrence(e);
    return '<button class="event-card' + (e.status === 'ended' ? ' is-ended' : '') + '" data-id="' + esc(e.id) + '">' +
      '<span class="ec-cadence">' + esc(e.cadence || 'Recurring') + '</span>' +
      '<span class="ec-title">' + esc(e.title) + '</span>' +
      '<span class="ec-when">' + esc(e.timeLabel || (e.unverified ? 'Time unconfirmed' : 'Time varies')) + '</span>' +
      (e.venue && e.venue.name ? '<span class="ec-where">' + esc(e.venue.name) + '</span>' : '') +
      '<span class="ec-foot">' + badges(e) + '</span>' +
      (next ? '<span class="ec-next">Next: ' + esc(R.relativeDay(next.date)) + '</span>' :
        (e.status === 'ended' ? '<span class="ec-next">Not running right now</span>' : '')) +
    '</button>';
  }

  function nextOccurrence(e) {
    var todayISO = R.toISO(R.today());
    for (var i = 0; i < e.occurrences.length; i++) {
      if (e.occurrences[i].date >= todayISO) return e.occurrences[i];
    }
    return null;
  }

  /* ---------------------------------------------------------
     Calendar view
     --------------------------------------------------------- */

  function renderCalendar() {
    var month = state.calMonth;
    var y = month.getFullYear(), m = month.getMonth();
    $('#cal-title').textContent = R.MONTHS[m] + ' ' + y;

    var evs = visibleEvents();
    var monthStart = R.toISO(new Date(y, m, 1, 12));
    var monthEnd = R.toISO(new Date(y, m + 1, 0, 12));

    // ongoing strip: span events overlapping this month
    var ongoing = evs.filter(function (e) {
      return e.isRun && e.date <= monthEnd && (e.endDate || e.date) >= monthStart;
    });
    var strip = $('#cal-ongoing');
    if (ongoing.length) {
      strip.hidden = false;
      strip.innerHTML = '<span class="co-label">Running through ' + R.MONTHS[m] + '</span>' +
        ongoing.map(function (e) {
          return '<button class="co-pill" data-id="' + esc(e.id) + '">' +
            '<span class="dot ' + (e.kind === 'recurring' ? 'dot-recurring' : 'dot-dated') + '"></span>' +
            esc(e.short || e.title) +
            '<span class="co-range">' + esc(R.formatDate(e.date, 'short') + '–' + R.formatDate(e.endDate || e.date, 'short')) + '</span>' +
          '</button>';
        }).join('');
    } else {
      strip.hidden = true;
      strip.innerHTML = '';
    }

    // occurrence index for the month
    var index = {};
    evs.forEach(function (e) {
      if (e.isRun) return;                        // shown in the strip instead
      if (e.kind === 'recurring' && !e.hasSchedule) return;
      if (e.status === 'ended') return;
      e.occurrences.forEach(function (occ) {
        if (occ.date >= monthStart && occ.date <= monthEnd) {
          if (e.exceptions && e.exceptions.indexOf(occ.date) !== -1) return;
          (index[occ.date] = index[occ.date] || []).push(occ);
        }
      });
    });
    Object.keys(index).forEach(function (d) {
      index[d].sort(function (a, b) { return (a.start || '99') < (b.start || '99') ? -1 : 1; });
    });

    var first = new Date(y, m, 1, 12);
    var gridStart = R.addDays(first, -first.getDay());
    var todayISO = R.toISO(R.today());
    var cells = '';

    // A month needs a sixth row only when it still has days left after 35 cells.
    var totalCells = R.addDays(gridStart, 34).getMonth() === m &&
      R.toISO(R.addDays(gridStart, 34)) < R.toISO(new Date(y, m + 1, 0, 12)) ? 42 : 35;

    for (var i = 0; i < totalCells; i++) {
      var d = R.addDays(gridStart, i);
      var iso = R.toISO(d);
      var out = d.getMonth() !== m;
      var list = index[iso] || [];
      var shown = list.slice(0, 3);

      cells += '<div class="cal-cell' + (out ? ' is-out' : '') +
        (iso === todayISO ? ' is-today' : '') +
        (list.length ? ' has-events' : '') + '" data-date="' + iso + '" role="gridcell">' +
        '<span class="cal-num">' + d.getDate() + '</span>' +
        shown.map(function (occ) {
          return '<button class="cal-pill' + (occ.event.kind === 'recurring' ? ' is-recurring' : '') +
            '" data-id="' + esc(occ.event.id) + '" title="' + esc(occ.event.title) + '">' +
            (occ.start ? '<span class="pt">' + esc(R.formatTime(occ.start).replace(':00', '').replace(' ', '')) + '</span>' : '') +
            '<span class="pn">' + esc(occ.event.short || occ.event.title) + '</span>' +
          '</button>';
        }).join('') +
        (list.length > 3 ? '<button class="cal-more" data-day="' + iso + '">+' + (list.length - 3) + ' more</button>' : '') +
        (list.length ? '<span class="cal-dots">' + list.slice(0, 6).map(function (o) {
          return '<i class="' + (o.event.kind === 'recurring' ? 'r' : '') + '"></i>';
        }).join('') + '</span>' : '') +
      '</div>';
    }

    $('#cal-body').innerHTML = cells;
    bindCalendar();
  }

  /* ---------------------------------------------------------
     Detail panel
     --------------------------------------------------------- */

  var ICONS = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.8h17M8.5 3.5v3M15.5 3.5v3"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s6.5-5.7 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.3 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.4"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3.5 11.3V4.5a1 1 0 0 1 1-1h6.8a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.8 6.8a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z"/><circle cx="8" cy="8" r="1.3"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><path d="M12 10v4.2M12 17.2v.1"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M13.5 10.5a4 4 0 0 1 0 5.7l-2.6 2.6a4 4 0 0 1-5.7-5.7l1.4-1.4"/><path d="M10.5 13.5a4 4 0 0 1 0-5.7l2.6-2.6a4 4 0 1 1 5.7 5.7l-1.4 1.4"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>'
  };

  function fact(icon, key, value) {
    return '<div class="p-fact">' + icon + '<div><div class="fk">' + esc(key) + '</div>' +
      '<div class="fv">' + value + '</div></div></div>';
  }

  function openEvent(id) {
    var e = state.events.filter(function (x) { return x.id === id; })[0];
    if (!e) return;

    var html = '';
    html += '<div class="p-kicker">' + badges(e, { kind: true }) + '</div>';
    html += '<h2 class="p-title" id="panel-title">' + esc(e.title) + '</h2>';
    if (e.summary) html += '<p class="p-tagline">' + esc(e.summary) + '</p>';

    /* facts */
    var facts = '';
    if (e.kind === 'recurring') {
      facts += fact(ICONS.cal, 'Cadence', esc(e.cadence || 'Recurring'));
      facts += fact(ICONS.clock, 'Time',
        esc(e.timeLabel || (e.unverified ? 'Not confirmed' : 'Varies')) +
        (e.recurrence && e.recurrence.doors ? ' <span class="fv-sub">· doors ' + esc(R.formatTime(e.recurrence.doors)) + '</span>' : '') +
        (e.recurrence && e.recurrence.durationNote ? ' <span class="fv-sub">· ' + esc(e.recurrence.durationNote) + '</span>' : ''));
      if (e.recurrence && e.recurrence.seasonNote) {
        facts += fact(ICONS.cal, 'Season', esc(e.recurrence.seasonNote));
      }
    } else {
      facts += fact(ICONS.cal, e.endDate && e.endDate !== e.date ? 'Dates' : 'Date', esc(dateRangeLabel(e)));
      facts += fact(ICONS.clock, 'Time', esc(e.timeLabel));
      if (e.extraTimes && e.extraTimes.length) {
        facts += fact(ICONS.clock, 'Also on', e.extraTimes.map(function (t) {
          return esc(t.label) + ' — ' + esc(R.formatTimeRange(t.start, t.end));
        }).join('<br>'));
      }
    }

    if (e.venue && e.venue.name) {
      var mu = mapUrl(e.venue);
      facts += fact(ICONS.pin, 'Where',
        esc(e.venue.name) +
        (e.venue.address ? '<br><span class="fv-sub">' + esc(e.venue.address) + '</span>' : '') +
        (mu ? '<br><a href="' + esc(mu) + '" target="_blank" rel="noopener noreferrer">Open in Maps →</a>' : ''));
    }
    if (e.cost) facts += fact(ICONS.tag, 'Cost', esc(e.cost));
    if (e.organizer) facts += fact(ICONS.user, 'Organizer', esc(e.organizer));
    (e.contact || []).forEach(function (c) {
      var v = /@/.test(c.value) ? '<a href="mailto:' + esc(c.value) + '">' + esc(c.value) + '</a>'
        : '<a href="tel:' + esc(c.value.replace(/[^0-9+]/g, '')) + '">' + esc(c.value) + '</a>';
      facts += fact(ICONS.mail, c.label, v);
    });
    html += '<div class="p-facts">' + facts + '</div>';

    /* warnings */
    if (e.unverified && e.unverifiedNote) {
      html += '<div class="p-alert">' + ICONS.warn + '<div><strong>Unconfirmed</strong><p>' + esc(e.unverifiedNote) + '</p></div></div>';
    }
    if (e.caution) {
      html += '<div class="p-alert p-alert-soft">' + ICONS.warn + '<div><strong>Verify first</strong><p>' + esc(e.caution) + '</p></div></div>';
    }

    /* description */
    if (e.description) {
      html += '<div class="p-section"><h3>Details</h3><div class="p-prose">' + md(e.description) + '</div></div>';
    }

    /* upcoming dates */
    var todayISO = R.toISO(R.today());
    var upcoming = e.occurrences.filter(function (o) { return o.date >= todayISO; });
    if (e.performances && e.performances.length) {
      html += '<div class="p-section"><h3>Performances</h3><div class="p-dates">' +
        e.performances.map(function (p, i) {
          return '<span class="p-date' + (i === 0 ? ' is-next' : '') + '">' +
            esc(R.formatDate(p.date, 'medium')) + ' · ' + esc(R.formatTime(p.start)) + '</span>';
        }).join('') + '</div></div>';
    } else if (e.kind === 'recurring' && upcoming.length) {
      html += '<div class="p-section"><h3>Next dates</h3><div class="p-dates">' +
        upcoming.slice(0, 8).map(function (o, i) {
          return '<span class="p-date' + (i === 0 ? ' is-next' : '') + '">' + esc(R.formatDate(o.date, 'medium')) + '</span>';
        }).join('') + '</div></div>';
    }

    /* links */
    if (e.links && e.links.length) {
      html += '<div class="p-section"><h3>Links &amp; tickets</h3><div class="p-links">' +
        e.links.map(function (l) {
          return '<a class="p-link" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
            ICONS.link + '<span class="pl-label">' + esc(l.label) + '</span>' +
            '<span class="pl-host">' + esc(hostOf(l.url)) + '</span></a>';
        }).join('') + '</div></div>';
    }

    /* tags */
    if (e.tags && e.tags.length) {
      html += '<div class="p-section"><h3>Tags</h3><div class="p-tags">' +
        e.tags.map(function (t) { return '<span class="p-tag">' + esc(t) + '</span>'; }).join('') + '</div></div>';
    }

    /* actions */
    if (e.hasSchedule !== false && e.occurrences.length) {
      html += '<div class="p-actions">' +
        '<button class="btn-primary" data-ics="' + esc(e.id) + '">' + ICONS.dl + 'Add to calendar (.ics)</button>' +
      '</div>';
    }

    showPanel(html);
  }

  function openDay(iso) {
    var evs = visibleEvents();
    var list = [];
    evs.forEach(function (e) {
      if (e.isRun) {
        if (e.date <= iso && (e.endDate || e.date) >= iso) list.push({ date: iso, event: e, spanning: true });
        return;
      }
      if (e.kind === 'recurring' && !e.hasSchedule) return;
      if (e.status === 'ended') return;
      e.occurrences.forEach(function (o) {
        if (o.date === iso && !(e.exceptions && e.exceptions.indexOf(iso) !== -1)) list.push(o);
      });
    });
    list.sort(function (a, b) { return (a.start || '99') < (b.start || '99') ? -1 : 1; });

    var html = '<div class="p-kicker"><span class="badge badge-cat">' + esc(R.relativeDay(iso)) + '</span></div>' +
      '<h2 class="p-title" id="panel-title">' + esc(R.formatDate(iso, 'long')) + '</h2>';

    if (!list.length) {
      html += '<p class="p-tagline">Nothing listed for this day.</p>';
    } else {
      html += '<p class="p-tagline">' + list.length + ' ' + (list.length === 1 ? 'event' : 'events') + ' listed.</p>' +
        '<div class="p-section"><div class="p-daylist">' +
        list.map(function (o) {
          return eventRow(o).replace('class="event-row"', 'class="event-row"');
        }).join('') + '</div></div>';
    }
    showPanel(html);
  }

  function showPanel(html) {
    state.lastFocus = document.activeElement;
    $('#panel-body').innerHTML = html;
    $('#panel').hidden = false;
    $('#scrim').hidden = false;
    document.body.classList.add('is-locked');
    $('#panel').scrollTop = 0;
    $('#panel').focus();
    bindPanel();
  }

  function closePanel() {
    $('#panel').hidden = true;
    $('#scrim').hidden = true;
    document.body.classList.remove('is-locked');
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* ---------------------------------------------------------
     ICS export
     --------------------------------------------------------- */

  var RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function icsStamp(iso, time, fallback) {
    var d = iso.replace(/-/g, '');
    var t = (time || fallback || '09:00').replace(':', '') + '00';
    return d + 'T' + t;
  }

  function addHours(time, h) {
    var p = (time || '09:00').split(':');
    var total = (+p[0] + h) * 60 + (+p[1] || 0);
    if (total >= 1440) total = 1439;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function buildICS(e) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Richmond Events//EN', 'CALSCALE:GREGORIAN'];
    var loc = [e.venue && e.venue.name, e.venue && e.venue.address].filter(Boolean).join(', ');
    var desc = (e.summary || '') +
      (e.unverified ? '\n\nUNCONFIRMED: ' + (e.unverifiedNote || 'Verify time and venue before attending.') : '') +
      ((e.links && e.links.length) ? '\n\n' + e.links.map(function (l) { return l.label + ': ' + l.url; }).join('\n') : '');

    function vevent(uid, startISO, startT, endT, rrule, allDay) {
      var out = ['BEGIN:VEVENT', 'UID:' + uid + '@richmond-events', 'DTSTAMP:' + icsStamp(R.toISO(R.today()), '09:00')  + 'Z'];
      if (allDay) {
        out.push('DTSTART;VALUE=DATE:' + startISO.replace(/-/g, ''));
        out.push('DTEND;VALUE=DATE:' + R.toISO(R.addDays(R.parseISO(startISO), 1)).replace(/-/g, ''));
      } else {
        out.push('DTSTART:' + icsStamp(startISO, startT));
        out.push('DTEND:' + icsStamp(startISO, endT || addHours(startT, 2)));
      }
      if (rrule) out.push('RRULE:' + rrule);
      out.push('SUMMARY:' + icsEscape(e.title));
      if (loc) out.push('LOCATION:' + icsEscape(loc));
      if (desc) out.push('DESCRIPTION:' + icsEscape(desc));
      if (e.links && e.links[0]) out.push('URL:' + e.links[0].url);
      out.push('END:VEVENT');
      return out;
    }

    if (e.kind === 'recurring' && e.recurrence && (e.recurrence.freq || e.recurrence.frequency)) {
      var rule = e.recurrence;
      var first = (nextOccurrence(e) || e.occurrences[0]);
      if (first) {
        var freq = String(rule.freq).toUpperCase();
        var parts = ['FREQ=' + (freq === 'BIWEEKLY' || freq === 'FORTNIGHTLY' ? 'WEEKLY' : freq)];
        var iv = rule.interval || (freq === 'BIWEEKLY' || freq === 'FORTNIGHTLY' ? 2 : 1);
        if (iv > 1) parts.push('INTERVAL=' + iv);
        if (rule.byDay) {
          parts.push('BYDAY=' + (Array.isArray(rule.byDay) ? rule.byDay : [rule.byDay])
            .map(function (c) { return RRULE_DAYS[RRULE_DAYS.indexOf(String(c).toUpperCase().slice(0, 2))] || c; })
            .join(','));
        }
        if (rule.nth) parts.push('BYSETPOS=' + (Array.isArray(rule.nth) ? rule.nth.join(',') : rule.nth));
        if (rule.byMonthDay) parts.push('BYMONTHDAY=' + (Array.isArray(rule.byMonthDay) ? rule.byMonthDay.join(',') : rule.byMonthDay));
        if (rule.until) parts.push('UNTIL=' + rule.until.replace(/-/g, '') + 'T235959');
        lines = lines.concat(vevent(e.id, first.date, rule.start, rule.end, parts.join(';'), !rule.start));
      }
    } else if (e.performances && e.performances.length) {
      e.performances.forEach(function (p, i) {
        lines = lines.concat(vevent(e.id + '-' + i, p.date, p.start, p.end, null, !p.start));
      });
    } else if (e.isRun || (e.isSpan && e.endDate !== e.date)) {
      var d0 = R.parseISO(e.date), d1 = R.parseISO(e.endDate || e.date), k = 0;
      var out = ['BEGIN:VEVENT', 'UID:' + e.id + '@richmond-events',
        'DTSTAMP:' + icsStamp(R.toISO(R.today()), '09:00') + 'Z',
        'DTSTART;VALUE=DATE:' + e.date.replace(/-/g, ''),
        'DTEND;VALUE=DATE:' + R.toISO(R.addDays(d1, 1)).replace(/-/g, ''),
        'SUMMARY:' + icsEscape(e.title)];
      if (loc) out.push('LOCATION:' + icsEscape(loc));
      if (desc) out.push('DESCRIPTION:' + icsEscape(desc));
      out.push('END:VEVENT');
      lines = lines.concat(out);
      void d0; void k;
    } else {
      var t = e.time || {};
      lines = lines.concat(vevent(e.id, e.date, t.start, t.end, null, !t.start));
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function downloadICS(id) {
    var e = state.events.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var blob = new Blob([buildICS(e)], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = id + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------------------------------------------------
     Reference block (venues / sources / exclusions)
     --------------------------------------------------------- */

  function renderReference() {
    var d = state.data;
    var el = $('#reference');
    if (!el) return;

    function linkList(items) {
      return '<ul class="ref-list">' + items.map(function (s) {
        return '<li>' + (s.url
          ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a>'
          : '<span>' + esc(s.name) + '</span>') +
          (s.note ? '<span class="ref-note">' + esc(s.note) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }

    el.innerHTML =
      '<details class="ref-block"><summary>Places to check <span class="ref-count">' + d.venues.length + '</span></summary>' +
        '<ul class="ref-list">' + d.venues.map(function (v) {
          return '<li>' + (v.url
            ? '<a href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">' + esc(v.name) + '</a>'
            : '<span>' + esc(v.name) + '</span>') +
            '<span class="ref-note">' + esc([v.address, v.note].filter(Boolean).join(' — ')) + '</span></li>';
        }).join('') + '</ul></details>' +

      '<details class="ref-block"><summary>Primary sources <span class="ref-count">' + d.sources.primary.length + '</span></summary>' +
        linkList(d.sources.primary) + '</details>' +

      '<details class="ref-block"><summary>Aggregators <span class="ref-count">' + d.sources.aggregators.length + '</span></summary>' +
        linkList(d.sources.aggregators) + '</details>' +

      '<details class="ref-block"><summary>Accounts worth following <span class="ref-count">' + d.sources.social.length + '</span></summary>' +
        linkList(d.sources.social) + '</details>' +

      '<details class="ref-block"><summary>Annual events to watch for <span class="ref-count">' + d.annual.length + '</span></summary>' +
        '<ul class="ref-list">' + d.annual.map(function (a) {
          return '<li>' + (a.url
            ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.name) + '</a>'
            : '<span>' + esc(a.name) + '</span>') +
            '<span class="ref-note">' + esc([a.when, a.where, a.note].filter(Boolean).join(' · ')) + '</span></li>';
        }).join('') + '</ul></details>' +

      '<details class="ref-block"><summary>Not Richmond BC — excluded <span class="ref-count">' + d.exclusions.length + '</span></summary>' +
        '<p class="ref-intro">Every aggregator mixes these in. They share the name but are somewhere else entirely.</p>' +
        '<ul class="ref-list">' + d.exclusions.map(function (x) {
          return '<li><span>' + esc(x.item) + '</span><span class="ref-note">Actually in ' + esc(x.actually) +
            (x.tell ? ' — ' + esc(x.tell) : '') + '</span></li>';
        }).join('') + '</ul></details>' +

      '<details class="ref-block"><summary>Data quality notes <span class="ref-count">' + d.dataNotes.length + '</span></summary>' +
        '<div class="p-prose ref-prose">' + d.dataNotes.map(function (n) { return md(n); }).join('') + '</div></details>';
  }

  /* ---------------------------------------------------------
     Binding
     --------------------------------------------------------- */

  function bindCards() {
    $$('#view-list [data-id]').forEach(function (el) {
      el.addEventListener('click', function () { openEvent(el.getAttribute('data-id')); });
    });
  }

  function bindCalendar() {
    $$('.cal-pill, .co-pill').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openEvent(el.getAttribute('data-id'));
      });
    });
    $$('.cal-more').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openDay(el.getAttribute('data-day'));
      });
    });
    $$('.cal-cell.has-events').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.cal-pill') || ev.target.closest('.cal-more')) return;
        openDay(el.getAttribute('data-date'));
      });
    });
  }

  function bindPanel() {
    $$('#panel-body [data-ics]').forEach(function (el) {
      el.addEventListener('click', function () { downloadICS(el.getAttribute('data-ics')); });
    });
    $$('#panel-body .p-daylist [data-id]').forEach(function (el) {
      el.addEventListener('click', function () { openEvent(el.getAttribute('data-id')); });
    });
  }

  function setView(v) {
    state.view = v;
    $$('.seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('#view-list').classList.toggle('is-active', v === 'list');
    $('#view-list').hidden = v !== 'list';
    $('#view-calendar').classList.toggle('is-active', v === 'calendar');
    $('#view-calendar').hidden = v !== 'calendar';
    if (v === 'calendar') renderCalendar();
    try { localStorage.setItem('re-view', v); } catch (err) { /* ignore */ }
  }

  function render() {
    renderList();
    if (state.view === 'calendar') renderCalendar();
  }

  function buildCategoryFilters() {
    var cats = {};
    state.events.forEach(function (e) { if (e.category) cats[e.category] = (cats[e.category] || 0) + 1; });
    var names = Object.keys(cats).sort();
    $('#category-filters').innerHTML =
      '<button class="chip is-active" data-cat="all">All categories</button>' +
      names.map(function (c) {
        return '<button class="chip" data-cat="' + esc(c) + '">' + esc(c) + '<span class="chip-n">' + cats[c] + '</span></button>';
      }).join('');

    $$('#category-filters .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.category = b.getAttribute('data-cat');
        $$('#category-filters .chip').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        render();
      });
    });
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('re-theme'); } catch (e) { /* ignore */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    $('#theme-toggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      if (!cur) {
        cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('re-theme', next); } catch (e) { /* ignore */ }
    });
  }

  function initEvents() {
    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });

    $$('#kind-filters .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        state.kind = b.getAttribute('data-kind');
        $$('#kind-filters .chip').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        render();
      });
    });

    var search = $('#search');
    var clear = $('#search-clear');
    search.addEventListener('input', function () {
      state.query = search.value.trim().toLowerCase();
      clear.hidden = !search.value;
      render();
    });
    clear.addEventListener('click', function () {
      search.value = ''; state.query = ''; clear.hidden = true; search.focus(); render();
    });

    $('#cal-prev').addEventListener('click', function () {
      state.calMonth = R.addMonths(state.calMonth, -1); renderCalendar();
    });
    $('#cal-next').addEventListener('click', function () {
      state.calMonth = R.addMonths(state.calMonth, 1); renderCalendar();
    });
    $('#cal-today').addEventListener('click', function () {
      var t = R.today();
      state.calMonth = new Date(t.getFullYear(), t.getMonth(), 1, 12);
      renderCalendar();
    });

    $('#panel-close').addEventListener('click', closePanel);
    $('#scrim').addEventListener('click', closePanel);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('#panel').hidden) closePanel();
      if (ev.key === '/' && document.activeElement !== search) { ev.preventDefault(); search.focus(); }
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */

  function boot(data) {
    state.data = data;
    state.events = normalise(data.events);

    var t = R.today();
    // Open the calendar on the first month that actually has something in it.
    var firstISO = state.events.reduce(function (min, e) {
      var up = e.occurrences.filter(function (o) { return o.date >= R.toISO(t); })[0];
      return up && (!min || up.date < min) ? up.date : min;
    }, null);
    var anchor = firstISO && firstISO > R.toISO(t) ? R.parseISO(firstISO) : t;
    state.calMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);

    if (data.meta) {
      document.title = data.meta.title + ' — ' + data.meta.place;
      $('#brand-sub').textContent = data.meta.tagline;
      $('#foot-meta').innerHTML =
        esc(data.meta.place) + ' · compiled ' + esc(R.formatDate(data.meta.compiled)) +
        ' · covering ' + esc(R.formatDate(data.meta.coverage.from, 'short')) + ' – ' +
        esc(R.formatDate(data.meta.coverage.to));
      $('#tz-note').textContent = data.meta.timezoneNote;
      $('#geo-note').textContent = data.meta.geographyNote;
    }

    buildCategoryFilters();
    initEvents();
    renderReference();

    var savedView = null;
    try { savedView = localStorage.getItem('re-view'); } catch (e) { /* ignore */ }
    render();
    setView(savedView === 'calendar' ? 'calendar' : 'list');
  }

  initTheme();

  // Prefer data embedded in the page (works from file:// and in sandboxed
  // hosts); otherwise fetch the JSON file the repo edits.
  var inline = document.getElementById('events-data');
  if (inline && inline.textContent.trim()) {
    try {
      boot(JSON.parse(inline.textContent));
      return;
    } catch (err) {
      $('#main').innerHTML = '<p class="empty">The embedded event data is not valid JSON (' +
        esc(err.message) + ').</p>';
      return;
    }
  }

  fetch('data/events.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(boot)
    .catch(function (err) {
      $('#main').innerHTML =
        '<p class="empty">Could not load the event data (' + esc(err.message) + ').<br>' +
        'If you opened this file directly from disk, run a local server instead: ' +
        '<code>python3 -m http.server</code></p>';
    });
})();
