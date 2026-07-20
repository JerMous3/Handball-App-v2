/* Handball-Tracker brand site.
   Everything here is progressive. With JS off the page is fully readable,
   every section is visible, the FAQ still opens (native <details>), and the
   only thing lost is the scroll choreography and the hero match simulation. */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------- reveals */

  /* The opacity-0 `reveal` class is applied by script, never in the markup, so
     the page is fully readable with JS off, blocked, or broken. */

  var reveals = document.querySelectorAll('[data-reveal]');

  /* Drops the class outright rather than transitioning to visible, so content
     appears even where transitions are never composited. */
  var showAll = function () {
    reveals.forEach(function (el) {
      el.classList.remove('reveal');
      el.setAttribute('data-in', 'true');
    });
  };

  if (reduced || !('IntersectionObserver' in window)) {
    showAll();
  } else {
    reveals.forEach(function (el) { el.classList.add('reveal'); });

    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.setAttribute('data-in', 'true');
        revealIO.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    reveals.forEach(function (el) { revealIO.observe(el); });

    /* Failsafe. Some engines stub IntersectionObserver or never deliver the
       first callback. Anything above the fold must have reported by now, so if
       nothing has, drop the animation rather than leave the page blank. */
    setTimeout(function () {
      if (!document.querySelector('[data-reveal][data-in="true"]')) showAll();
    }, 1200);
  }

  /* ------------------------------------------------- nav border state */

  var nav = document.getElementById('nav');

  if (nav && 'IntersectionObserver' in window) {
    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;';
    document.body.prepend(sentinel);

    new IntersectionObserver(function (entries) {
      nav.setAttribute('data-stuck', String(!entries[0].isIntersecting));
    }).observe(sentinel);
  }

  /* --------------------------------------------------------- the rail */

  var railItems = Array.prototype.slice.call(document.querySelectorAll('.rail-item'));

  if (railItems.length && 'IntersectionObserver' in window) {
    var sections = railItems
      .map(function (item) { return document.getElementById(item.getAttribute('data-for')); })
      .filter(Boolean);

    var visible = new Array(sections.length).fill(false);

    var paint = function () {
      var active = visible.lastIndexOf(true);
      if (active < 0) active = 0;

      railItems.forEach(function (item, i) {
        item.setAttribute('data-active', String(i === active));
        item.setAttribute('data-passed', String(i < active));
      });
    };

    var railIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var i = sections.indexOf(e.target);
        if (i > -1) visible[i] = e.isIntersecting;
      });
      paint();
    }, { rootMargin: '-68px 0px -68% 0px' });

    sections.forEach(function (s) { railIO.observe(s); });
    paint();

    /* Rail markers double as jump links */
    railItems.forEach(function (item, i) {
      var target = sections[i];
      if (!target) return;
      item.setAttribute('role', 'link');
      item.setAttribute('tabindex', '0');
      item.style.cursor = 'pointer';

      var jump = function () {
        target.scrollIntoView({
          behavior: reduced ? 'auto' : 'smooth',
          block: 'start'
        });
      };

      item.addEventListener('click', jump);
      item.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jump(); }
      });
    });
  }

  /* The FAQ is native <details>. It needs no script. */

  /* ------------------------------------------- hero match simulation */

  var clockEl = document.getElementById('boardClock');
  var logEl = document.getElementById('boardLog');

  if (clockEl && logEl) {
    var homeEl = document.getElementById('scoreHome');
    var awayEl = document.getElementById('scoreAway');
    var footEl = document.getElementById('boardFoot');

    var MAX_ROWS = 6;
    var score = { home: 12, away: 9 };
    var seconds = 11 * 60 + 42;

    var seed = [
      { t: '09:12', who: 'Lars Bakker',  what: 'Goal',    kind: 'goal' },
      { t: '10:03', who: 'Sven de Vries', what: 'Save',   kind: 'save' },
      { t: '11:20', who: 'Daan Visser',  what: 'Shot',    kind: 'shot' }
    ];

    var script = [
      { after: 4200, who: 'Milan Smit',    what: 'Goal',       kind: 'goal', home: 1 },
      { after: 4000, who: 'Tijn Mulder',   what: 'Yellow',     kind: 'card' },
      { after: 5200, who: 'HC Tornado',    what: 'Goal',       kind: 'goal', away: 1 },
      { after: 4400, who: 'Sven de Vries', what: 'Save',       kind: 'save' },
      { after: 4800, who: 'Ruben Bos',     what: 'Goal',       kind: 'goal', home: 1 },
      { after: 5000, who: 'Lars Bakker',   what: 'Assist',     kind: 'shot' },
      { after: 5600, who: 'Daan Visser',   what: '2 min',      kind: 'card' }
    ];

    var fmt = function (s) {
      var m = Math.floor(s / 60);
      var r = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    };

    var render = function (ev, animate) {
      var li = document.createElement('li');
      li.className = 'log-row' + (animate ? ' log-enter' : '');
      li.innerHTML =
        '<span class="t tnum"></span>' +
        '<span class="dot dot-' + ev.kind + '"></span>' +
        '<span class="who"></span>' +
        '<span class="what"></span>';
      li.querySelector('.t').textContent = ev.t;
      li.querySelector('.who').textContent = ev.who;
      li.querySelector('.what').textContent = ev.what;

      logEl.prepend(li);
      while (logEl.children.length > MAX_ROWS) logEl.lastElementChild.remove();
    };

    seed.forEach(function (ev) { render(ev, false); });

    if (reduced) {
      /* Static, fully populated, no ticking. Matches the 12:30 rail marker. */
      clockEl.textContent = '12:30';
      script.slice(0, 3).forEach(function (ev) {
        render({ t: '12:0' + (script.indexOf(ev) + 1), who: ev.who, what: ev.what, kind: ev.kind }, false);
        if (ev.home) score.home += ev.home;
        if (ev.away) score.away += ev.away;
      });
      homeEl.textContent = score.home;
      awayEl.textContent = score.away;
      footEl.textContent = 'Live match view';
      return;
    }

    clockEl.textContent = fmt(seconds);
    homeEl.textContent = score.home;
    awayEl.textContent = score.away;

    var timers = [];
    var ticker = null;

    var start = function () {
      ticker = setInterval(function () {
        seconds += 1;
        clockEl.textContent = fmt(seconds);
      }, 1000);

      var delay = 1800;
      script.forEach(function (ev) {
        delay += ev.after;
        timers.push(setTimeout(function () {
          render({ t: fmt(seconds), who: ev.who, what: ev.what, kind: ev.kind }, true);
          if (ev.home) { score.home += ev.home; homeEl.textContent = score.home; }
          if (ev.away) { score.away += ev.away; awayEl.textContent = score.away; }
        }, delay));
      });

      timers.push(setTimeout(function () {
        footEl.textContent = 'Recording. Every event kept.';
      }, delay + 2000));
    };

    var stop = function () {
      clearInterval(ticker);
      timers.forEach(clearTimeout);
      timers = [];
    };

    /* Only run while the board is actually on screen */
    if ('IntersectionObserver' in window) {
      var running = false;
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !running) { running = true; start(); }
        else if (!entries[0].isIntersecting && running) { running = false; stop(); }
      }, { threshold: 0.25 }).observe(logEl.closest('.board'));
    } else {
      start();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
    });
  }
})();
