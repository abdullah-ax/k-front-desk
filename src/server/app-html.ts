/**
 * GENERATED FILE. Edit src/server/app.html and run `pnpm build:app`.
 */
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f4f4f2">
<link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Geist+Mono&family=Instrument+Serif&display=swap" rel="stylesheet">
<title>Gulf Breeze Front Desk</title>
<style>
/* The readability rework. Six rules, from the review, decide most of what is
   on this sheet:
     1. one primary action per card, the rest behind "···";
     2. a chip only where it adds a fact the sentence lacks;
     3. no surface draws a list another visible surface already draws;
     4. three type sizes (13/15/22), two weights (400/600), one family, mono
        only for IDs and timestamps, no letterspaced all-caps heads;
     5. one hue. Kebra orange means "needs a human"; "late" is the same hue
        darkened plus a hatch, never a second colour. Red is kept for exactly
        two things: a live call's dot and the cancel button;
     6. empty means one dim line.
   Every text tone below clears WCAG AA (4.5:1) on every surface it can land
   on, computed, not eyeballed. The brand's 60% ink is 4.2:1 on paper and the
   mock's quiet greys were lower still, so --mute is darker than either and
   --faint is the same value; size and weight carry the rest. */
:root{
  --sans:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --serif:"Instrument Serif",Georgia,serif;

  /* Kebra ink, at full and at the alphas the brand ships, composited to solid
     values so a text tone is the same colour on every surface. --muted is ink
     at 68%, not the brand's 60%: 60% is 4.2:1 on the paper and fails AA. */
  --ink:#222121; --ink-2:#3f3e3e; --ink-3:#595959; --mute:#636262; --faint:#636262;
  --dark:#222121; --on-dark:#fffffd;

  --bg:#fffffd; --side:#f4f4f2; --rail:#f4f4f2; --card:#ffffff; --sunk:#f4f4f2; --sel:#fbfbfb;
  --hover:#e7e7e5; --ctl:#f4f4f2; --menu:#f4f4f2; --navon:#dfdfdd; --navhover:#e9e9e8;

  --line:#e4e4e4; --line-soft:#e4e4e4; --line-in:#e4e4e4; --line-row:#f0efef;
  --line-btn:#cacaca; --line-strong:#cacaca; --line-ctl:#858585;

  /* Kebra orange, the one brand hue, and it means "needs a human". The fill
     and the wash are the brand's own values. #fe6a1a is 2.9:1 on white, so a
     dot or a bar uses --need (the same hue, barely darker, 3:1) and the one
     place it is set as text uses --need-ink (same hue again, 4.6:1). */
  --accent:#fe6a1a; --accent-soft:#fff0e8; --need:#f05d00; --need-ink:#bc2800; --need-wash:#fff0e8;
  /* late is not a second hue: the same orange darkened, and a hatch */
  --late:#a93900; --late-wash:#ededed;
  /* red: a live call's dot, and the cancel button. Nowhere else. */
  --stop:#b3261e;
  /* a normal block on the board, and the quiet dot on a routine row */
  --plain:#ededed; --plain-bar:#bdbcbc; --quiet:#cacaca;
  --r-ctl:6px; --r-panel:8px;
  color-scheme:light;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);height:100dvh;overflow:hidden;
  font:400 13px/1.45 var(--sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-size:15px;font-weight:600;line-height:1.3}
p{margin:0}
button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0;touch-action:manipulation;text-align:left}
a{color:inherit}
a,button,input,[role="button"]{-webkit-tap-highlight-color:transparent}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.num{font-variant-numeric:tabular-nums}
svg{display:block;width:16px;height:16px;flex:none}
:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* ---- the shell: a labelled sidebar, a top bar, the main column, a rail of
   live state. Regions meet at hairlines; the main column is the one that
   scrolls, and the board inside it takes whatever height is left. ---- */
.console{height:100dvh;display:grid;grid-template-columns:196px minmax(0,1fr) 288px;grid-template-rows:56px minmax(0,1fr);background:var(--bg)}
.side{grid-row:1/3;grid-column:1;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px;gap:2px;min-height:0;overflow:auto}
.topbar{grid-row:1;grid-column:2/4;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;gap:16px;padding:0 22px;min-width:0;background:var(--bg)}
.main{grid-row:2;grid-column:2;min-width:0;min-height:0;display:flex;flex-direction:column;gap:18px;padding:22px;overflow:auto;overscroll-behavior:contain}
/* A screen whose own content scrolls. The column stops scrolling so the child
   can be given a real height to scroll within — without this the card grows to
   fit 1,327 rows and the page scrolls instead, taking the filters with it. */
body.tall .main{overflow:hidden}
body.tall .main > .card,
body.tall .main > .kanban{flex:1;min-height:0}
.rail{grid-row:2;grid-column:3;border-left:1px solid var(--line-soft);background:var(--rail);min-height:0;display:flex;flex-direction:column;overflow:auto;overscroll-behavior:contain}
body.gated .side,body.gated .topbar,body.gated .rail{display:none}
body.gated .console{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
body.gated .main{grid-row:1;grid-column:1}

/* sidebar */
.brand{display:flex;align-items:center;gap:9px;padding:6px 8px 18px}
.brand .mk{width:22px;height:22px;border-radius:var(--r-ctl);background:var(--dark);color:#fff;font-weight:600;line-height:22px;text-align:center;flex:none}
.brand b{font-size:15px;font-weight:600;white-space:nowrap}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-ctl);color:var(--ink-3);text-decoration:none;white-space:nowrap;min-width:0}
.nav a:hover{background:var(--navhover);color:var(--ink)}
.nav a.on{background:var(--navon);color:var(--ink);font-weight:600}
.nav a .lb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.nav .ct{margin-left:auto;color:var(--ink-3);font-variant-numeric:tabular-nums;font-weight:400}
.nav .ct.need{color:var(--need-ink);font-weight:600}
.side .foot{margin-top:auto;border-top:1px solid var(--line);padding:12px 4px 4px}
.side .who{display:flex;align-items:center;gap:9px;width:100%;padding:4px 4px;border-radius:var(--r-ctl);color:var(--mute);min-width:0}
.side .who:hover{background:var(--navhover);color:var(--ink)}
.side .who .lb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{width:24px;height:24px;border-radius:99px;background:var(--navon);color:var(--ink-3);font-weight:600;display:flex;align-items:center;justify-content:center;flex:none}

/* live: a blinking red dot and the word. Nothing else, no pills. */
.livechip{display:inline-flex;align-items:center;gap:6px;color:var(--stop);font-weight:600;white-space:nowrap}
.dot{width:7px;height:7px;border-radius:99px;background:var(--stop);flex:none}
@media(prefers-reduced-motion:no-preference){.dot{animation:blink 1.3s steps(1,end) infinite}
@keyframes blink{0%,50%{opacity:1}50.01%,100%{opacity:.15}}}

/* top bar */
.topbar h1{font-size:15px;white-space:nowrap}
.topbar .sub{color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ask{margin-left:auto;width:300px;max-width:40%;min-width:150px;display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--ctl);border-radius:var(--r-ctl);padding:0 11px;height:34px;color:var(--mute);white-space:nowrap;overflow:hidden;flex:0 1 300px}
.ask:hover{background:var(--hover)}
.ask svg{width:14px;height:14px}
.ask span{flex:1;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ask kbd{font:inherit;color:var(--faint)}
.clock{color:var(--mute);white-space:nowrap}

/* ---- controls ---- */
.btn{height:32px;padding:0 13px;border:1px solid var(--line-btn);border-radius:var(--r-ctl);background:var(--card);color:var(--ink);display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:none}
.btn:hover{background:var(--ctl)}
.btn.key{background:var(--accent);color:var(--ink);border-color:var(--accent);font-weight:600}
.btn.key:hover{filter:brightness(.95)}
.btn.quiet{border-color:transparent;color:var(--mute);background:transparent}
.btn.quiet:hover{background:var(--hover);color:var(--ink)}
.btn.stop{background:var(--stop);color:#fff;border-color:var(--stop);font-weight:600}
.btn.stop:hover{opacity:.92}
.btn.small{height:28px;padding:0 11px}
.btn:disabled{opacity:.5;cursor:default}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:var(--r-ctl);overflow:hidden;flex:none;background:var(--card)}
.seg button{padding:0 13px;height:30px;color:var(--ink-3);white-space:nowrap}
.seg button:hover{background:var(--hover)}
.seg button.on{background:var(--dark);color:#fff;font-weight:600}
.ib{width:30px;height:30px;border:1px solid var(--line);border-radius:var(--r-ctl);display:flex;align-items:center;justify-content:center;color:var(--ink-3);background:var(--card);flex:none}
.ib:hover{background:var(--hover)}
input,select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line-ctl);border-radius:var(--r-ctl);padding:6px 10px;min-height:32px}
textarea{resize:vertical;width:100%;line-height:1.45}
input::placeholder,textarea::placeholder{color:var(--mute)}
/* the overflow: a row of quiet buttons that only exists once "···" is pressed */
.menu{display:flex;gap:7px;flex-wrap:wrap;padding-top:2px}
.menu .btn{height:30px;background:var(--menu);border-color:var(--line);color:var(--ink-3)}
.menu .btn:hover{color:var(--ink);background:var(--hover)}
.menu .btn.stop{background:var(--stop);color:#fff;border-color:var(--stop)}

/* ---- cards, and the one-line queue row ---- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-panel);overflow:hidden;min-width:0;flex:none}
.card-h{padding:12px 18px;border-bottom:1px solid var(--line-in);display:flex;align-items:center;gap:9px;min-width:0;flex-wrap:wrap}
.card-h h2{font-size:15px}
.card-h .n{color:var(--mute);font-variant-numeric:tabular-nums}
.card-h .r{margin-left:auto;display:flex;align-items:center;gap:8px}
.card-h .r a,.card-h .r button.lnk{color:var(--ink-3);text-decoration:none}
.card-h .r a:hover,.card-h .r button.lnk:hover{color:var(--ink)}
.qrow{padding:15px 18px;border-bottom:1px solid var(--line-row);background:var(--card)}
.qrow:last-child{border-bottom:0}
.qrow.on{background:var(--sel)}
.qrow .top{display:flex;align-items:flex-start;gap:11px;width:100%;color:inherit}
.qrow .top:hover .head{color:var(--ink)}
.dot7{width:7px;height:7px;border-radius:99px;flex:none;background:var(--quiet)}
.qrow.on .dot7{margin-top:7px}
.dot7.need{background:var(--need)}
.dot7.late{background:var(--late)}
.qrow .head{font-size:15px;line-height:1.35;min-width:0}
.qrow .line{flex:1;min-width:0;display:flex;align-items:baseline;gap:12px;white-space:nowrap;overflow:hidden}
.qrow .line .head{overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.qrow .line .meta{margin:0;flex:none;gap:12px;flex-wrap:nowrap}
.qrow .top{align-items:center}
.qrow.on .top{align-items:flex-start}
.qrow.on .head{font-weight:600}
.qrow .meta{display:flex;gap:18px;color:var(--mute);flex-wrap:wrap;margin-top:3px;min-width:0}
.qrow .meta .q{color:var(--faint)}
.qrow .tm{color:var(--faint);flex:none;font-family:var(--mono);font-variant-numeric:tabular-nums}
.qrow .body{display:flex;flex-direction:column;gap:11px;padding-top:12px}
.qrow .why{color:var(--ink-3);line-height:1.5}
.qrow .acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qrow .src{margin-left:auto;color:var(--faint)}
.empty{padding:16px 18px;color:var(--faint)}
/* THE TICKET BOARD. Four columns, each scrolling on its own, so the size of
   each pile is visible without scrolling anything. */
.kanban{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  gap:14px;align-items:stretch}
.col{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--card);
  border:1px solid var(--line);border-radius:8px;overflow:hidden}
.col-h{display:flex;align-items:baseline;gap:8px;padding:11px 14px;border-bottom:1px solid var(--line-in);
  background:var(--sunk)}
.col-h h2{margin:0;font-size:13px;font-weight:600}
.col-h .n{margin-left:auto;color:var(--mute);font-variant-numeric:tabular-nums}
.col-b{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px;
  display:flex;flex-direction:column;gap:7px}
/* One ticket. Two lines: what it is, and the few facts that decide whether you
   pick it up now. Everything else is behind the click. */
.tcard{display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;
  padding:9px 11px;border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:5px;background:var(--card);cursor:pointer;width:100%;font:inherit;color:var(--ink)}
.tcard:hover{background:var(--hover)}
.tcard:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.tcard .h{font-weight:500;line-height:1.35}
.tcard .m{color:var(--mute);font-size:12px;line-height:1.4}
.tcard.quiet{border-left-color:var(--line-ctl)}
.tcard.urgent{border-left-color:var(--stop)}
.tcard .flag{background:var(--stop);color:#fff;border-radius:3px;padding:1px 6px;font-size:10.5px;
  font-weight:600;text-transform:uppercase;letter-spacing:.02em}
@media(max-width:1200px){.kanban{grid-template-columns:repeat(2,minmax(0,1fr));overflow:auto}}
/* How long somebody has been waiting for a call back, above the row itself. */
.waited{display:flex;gap:8px;align-items:center;padding:8px 16px 0;color:var(--mute);font-size:12.5px}
.waited .urgent{color:#fff;background:var(--stop);border-radius:3px;padding:1px 6px;font-weight:600;
  font-size:11px;letter-spacing:.02em;text-transform:uppercase}
/* One thing the record knows, and underneath it the words it was read from. */
/* One thing known, FULL WIDTH. This was a two-column grid — a leftover \`.fact\`
   rule from the previous design, defined later in the sheet and quietly winning
   — which squeezed every fact into 110 pixels so it wrapped after three words
   and the panel read as a broken table. Its own class now, so the two cannot
   collide again. */
.kfact{padding:11px 16px;border-bottom:1px solid var(--line-row);display:block}
.kfact .val{color:var(--ink);line-height:1.45;display:block}
.kfact.code .val{font-weight:600}
.kfact .src{margin-top:5px;display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;
  color:var(--mute);font-size:12.5px;line-height:1.5}
.kfact .src q{color:var(--ink-3)}
.kfact .src .from{color:var(--faint);font-family:var(--mono);display:flex;gap:10px}
/* What the office wrote on a visit, under the visit. */
.jnote{padding:6px 16px 10px 30px;border-bottom:1px solid var(--line-row);color:var(--ink-3);
  font-size:12.5px;line-height:1.55;display:flex;flex-wrap:wrap;gap:8px}
.jnote .from{color:var(--faint);font-family:var(--mono)}
/* The answer, in a sentence, above the evidence. */
.insight{margin:0 18px 12px;padding:12px 14px;background:var(--paper);border-left:3px solid var(--accent);
  border-radius:4px;font-size:15px;line-height:1.5;color:var(--ink)}
/* Where to go next. Buttons, because advice you have to retype is not help. */
.nextq{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:12px 18px 4px}
.nextq .sub{margin-right:2px}
/* The "show the demo calls" line at the foot of a list. A quiet full-width row,
   not a button that competes with the calls above it. */
.more{display:block;width:100%;text-align:left;padding:12px 18px;border:0;background:none;
  color:var(--mute);border-top:1px solid var(--line-row);cursor:pointer;font:inherit}
.more:hover{background:var(--hover);color:var(--ink)}
.skel{padding:16px 18px;color:var(--faint)}
.note{color:var(--faint);line-height:1.6}
.tabs{display:inline-flex;border:1px solid var(--line);border-radius:var(--r-ctl);overflow:hidden;background:var(--card);flex:none;align-self:flex-start}
.tabs button{padding:0 14px;height:32px;color:var(--ink-3);white-space:nowrap}
.tabs button:hover{background:var(--hover)}
.tabs button.on{background:var(--dark);color:#fff;font-weight:600}

/* ---- Dispatch: the date row, one summary line, the queue, the board ---- */
.daterow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.daterow .d{font-size:15px;font-weight:600;white-space:nowrap;min-width:0}
.daterow .grow{flex:1}
.sumline{display:flex;gap:28px;margin-top:-8px;flex-wrap:wrap;color:var(--mute)}
.sumline b{font-weight:600;color:var(--ink);margin-right:6px;font-variant-numeric:tabular-nums}
.sumline b.late{color:var(--late)}
.sumline b.need{color:var(--need-ink)}

/* the board card owns the remaining height and scrolls inside itself */
.card.fill{flex:1;min-height:280px;display:flex;flex-direction:column}
.bd-wrap{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;position:relative}
.board{min-width:960px;--cells:26;position:relative}
.grow{display:grid;grid-template-columns:170px repeat(var(--cells),minmax(28px,1fr));border-bottom:1px solid var(--line-row)}
.grow.axis{position:sticky;top:0;z-index:4;background:var(--card);border-bottom-color:var(--line-in)}
.grow.axis .rl{color:var(--mute);font-weight:600;justify-content:center;padding:10px 16px}
.hcell{grid-column:span 2;border-left:1px solid var(--line-row);padding:10px 0 10px 8px;color:var(--faint);font-family:var(--mono);font-variant-numeric:tabular-nums}
.rl{padding:8px 16px;display:flex;flex-direction:column;justify-content:center;gap:2px;border-right:1px solid var(--line-in);background:var(--card);position:sticky;left:0;z-index:2;overflow:hidden;min-width:0}
.rl b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rl span{color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rl span.late{color:var(--late);font-weight:600}
.grow.tech{position:relative;min-height:46px}
.grow.tech>.rl{grid-row:1;grid-column:1}
.lane,.blocks{grid-column:2/-1;grid-row:1;display:grid;grid-template-columns:repeat(var(--cells),minmax(28px,1fr))}
.lane{pointer-events:none}
.tick{border-left:1px solid var(--line-row);grid-row:1}
.tick:nth-child(even){border-left-color:transparent}
.blocks{align-items:center}
/* an empty half hour is a drop target and, on a click, a booking at that time */
.drop{grid-row:1;align-self:stretch;margin:4px 0;border-radius:4px;cursor:cell}
/* Booked or moved by the agent. A folded corner, in ink — the same mark on the
   day board, the week and the month, so it reads the same wherever you meet it. */
.job.byagent::after,.mj.byagent::after{content:"";position:absolute;top:0;right:0;
  border-width:0 7px 7px 0;border-style:solid;border-color:transparent var(--ink-3) transparent transparent;
  opacity:.55;pointer-events:none}
.job.byagent{position:relative}
.mj.byagent{position:relative}
.bd-key .fold{display:inline-block;width:0;height:0;border-width:0 8px 8px 0;border-style:solid;
  border-color:transparent var(--ink-3) transparent transparent;opacity:.55;vertical-align:middle}
/* While a block is being dragged. The cell under the pointer is the only thing
   that lights up, so it is never ambiguous where the job will land. */
.drop.over{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--need)}
.job.dragging{opacity:.5;cursor:grabbing}
body.dragging-job{cursor:grabbing;user-select:none}
body.dragging-job .job{cursor:grabbing}
.drop:hover{background:var(--hover)}
.drop.over{background:var(--hover);outline:1px dashed var(--line-ctl);outline-offset:-1px}
/* a normal job is a quiet block with a grey bar; the two accents are the only
   loud things in a row, and provenance is text in the tooltip, not a colour */
.job{grid-row:1;position:relative;margin-right:2px;padding:0 9px;border-radius:4px;min-width:0;height:32px;
  background:var(--plain);border-left:3px solid var(--plain-bar);display:flex;align-items:center;gap:8px;
  overflow:hidden;cursor:grab;z-index:1;color:var(--ink)}
.job:hover{filter:brightness(.97)}
.job:active{cursor:grabbing}
.job b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:1;min-width:0}
.job span{color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.job.narrow{padding:0 6px}
.job.narrow span{display:none}
.job.need{background:var(--need-wash);border-left-color:var(--need)}
.job.late{border-left-color:var(--late);background:repeating-linear-gradient(135deg,var(--line-strong) 0 2px,var(--plain) 2px 8px)}
.job.stop{background:var(--sunk);border-left-color:var(--quiet)}
.job.stop b{text-decoration:line-through;color:var(--mute);font-weight:400}
.grow.unrow .rl b{color:var(--need-ink)}
.unrow .blocks{display:flex;align-items:center;gap:6px;padding:7px 8px;overflow-x:auto}
.unrow .job{flex:none;max-width:240px}
.nowline{position:absolute;top:0;bottom:0;width:1px;background:var(--late);opacity:.55;z-index:3;pointer-events:none}
.bd-foot{display:flex;align-items:center;gap:18px;padding:11px 16px;background:var(--sunk);border-top:1px solid var(--line-in);color:var(--mute);flex:none;flex-wrap:wrap}
.bd-foot .sw{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle}
.bd-foot .r{margin-left:auto;color:var(--faint)}
.bd-foot button.lnk{color:var(--ink-3)}
.bd-foot button.lnk:hover{color:var(--ink)}

/* the week: seven columns, jobs stacked by time; today is a rule, not a fill */
.week{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.wk-col{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--line-row)}
.wk-col:last-child{border-right:0}
.wk-col.today::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--ink);z-index:2}
.wk-h{padding:10px 12px;border-bottom:1px solid var(--line-in);display:flex;align-items:baseline;gap:6px;color:var(--mute);white-space:nowrap;overflow:hidden;width:100%}
.wk-h:hover{background:var(--hover)}
.wk-h b{font-weight:600;color:var(--ink)}
.wk-h .n{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}
.wk-b{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px;display:flex;flex-direction:column;gap:5px}
.job.wk{width:100%;height:auto;margin:0;padding:6px 9px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 8px;align-items:baseline;cursor:pointer;flex:none}
.job.wk .tm{color:var(--ink-3);font-family:var(--mono);font-variant-numeric:tabular-nums}
.job.wk .by{grid-column:2}
/* The customer name wraps rather than clipping. Seven columns across 1000px
   leaves about 140px a day, and an ellipsis at ten characters turned
   "Starfish Hospitality" and "Starfish Holdings" into the same row — the name
   is the one fact that says which job this is. Two lines, then it clamps. */
.job.wk b{white-space:normal;overflow-wrap:anywhere;line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* the month: 7 columns, 5 or 6 week rows, edge days dimmed, today ruled */
.month{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.mo-h{padding:10px 12px;border-bottom:1px solid var(--line-in);color:var(--mute);font-weight:600;white-space:nowrap;overflow:hidden}
.mo-d{border-right:1px solid var(--line-row);border-bottom:1px solid var(--line-row);padding:8px 10px;display:flex;flex-direction:column;gap:3px;min-width:0;min-height:0;overflow:hidden;color:inherit;position:relative;width:100%;background:var(--card);align-items:stretch}
.mo-d:hover{background:var(--hover)}
.mo-d.out{background:var(--sunk)}
.mo-d.out .d b,.mo-d.out .mj,.mo-d.out .mj .t{color:var(--faint)}
.mo-d.today::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--ink)}
.mo-d .d{display:flex;align-items:baseline;gap:6px;min-width:0}
.mo-d .d b{font-weight:600;font-variant-numeric:tabular-nums}
.mo-d .d .n{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}
.mj{display:flex;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--ink-3);padding-left:7px;box-shadow:inset 2px 0 0 var(--plain-bar);border-radius:2px;line-height:1.5}
.mj .t{color:var(--faint);font-family:var(--mono);font-variant-numeric:tabular-nums;flex:none}
.mj .w{overflow:hidden;text-overflow:ellipsis;min-width:0}
.mj.need{box-shadow:inset 2px 0 0 var(--need)}
.mj.late{box-shadow:inset 2px 0 0 var(--late)}
.mj.stop{text-decoration:line-through;color:var(--mute);box-shadow:inset 2px 0 0 var(--quiet)}
.mo-more{color:var(--faint);padding-left:7px}

/* the list */
.bar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line-in);background:var(--sunk);color:var(--mute);flex-wrap:wrap;flex:none}
.bar .r{margin-left:auto;display:flex;gap:8px;align-items:center}
.bar input{min-height:30px;padding:0 10px;min-width:150px;max-width:240px}
.scrollx{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0}
table.list{width:100%;border-collapse:collapse}
.list th{position:sticky;top:0;background:var(--sunk);text-align:left;font-weight:600;color:var(--mute);height:36px;padding:0 14px;border-bottom:1px solid var(--line-in);white-space:nowrap;z-index:1}
.list th button{color:inherit;font-weight:inherit}
.list th button:hover{color:var(--ink)}
.list td{padding:8px 14px;border-bottom:1px solid var(--line-row);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.list tbody tr{cursor:pointer}
.list tbody tr:hover td{background:var(--hover)}
.list td.dim{color:var(--mute)}
/* A row that goes somewhere. Keyboard reachable, because a table of 1,327
   buildings that only answers a mouse is a table half the office cannot use. */
.list tr.click{cursor:pointer}
.list tr.click:hover td{background:var(--hover)}
.list tr.click:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}
/* Money owed is the one number on this screen worth colouring, and only when
   there is some. */
.list td.owed{color:var(--need-ink);font-weight:600}
.list td.wrap{white-space:normal;min-width:120px;line-height:1.4}
.list .need{color:var(--need-ink);font-weight:600}
.list .late{color:var(--late);font-weight:600}

/* ---- the rail: live state only ---- */
.rail-h{padding:16px 18px 12px;display:flex;align-items:center;gap:8px}
.rail-h h2{font-size:15px}
.rail-h .n{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}
.rail-h a{color:inherit;text-decoration:none}
.rail-h a:hover{text-decoration:underline;text-underline-offset:3px}
.rail-b{padding:0 18px 16px;display:flex;flex-direction:column;gap:8px}
.rail-sec{border-top:1px solid var(--line-soft);padding:16px 18px;display:flex;flex-direction:column;gap:2px}
.rail-sec .rail-h{padding:0 0 8px}
.rail .dim{color:var(--faint);line-height:1.5}
.lc{background:var(--card);border:1px solid var(--line);border-radius:var(--r-panel);padding:13px 15px;display:flex;flex-direction:column;gap:6px}
.lc b{font-size:15px;font-weight:600;line-height:1.3}
.lc .m{color:var(--mute);line-height:1.4}
.lc .a{display:flex;gap:7px;padding-top:4px;flex-wrap:wrap}
.nx{display:flex;align-items:flex-start;gap:9px;padding:7px 0;width:100%;color:var(--ink-2);line-height:1.45;min-width:0}
.nx:hover{opacity:.7}
.dot6{width:6px;height:6px;border-radius:99px;flex:none;margin-top:7px;background:var(--need)}
.dot6.late{background:var(--late)}
.nx .t{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.nx .tm{color:var(--faint);flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-variant-numeric:tabular-nums}
.rail-foot{margin-top:auto;padding:14px 18px;border-top:1px solid var(--line-soft);color:var(--faint);line-height:1.55}

/* ---- two-column screens, records, lists ---- */
.split{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;flex:1;min-height:0}
.split>*{min-width:0;min-height:0}
.split .card{display:flex;flex-direction:column;overflow:hidden}
.split .card .scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.hd{display:flex;align-items:flex-start;gap:14px;padding:18px 22px;border-bottom:1px solid var(--line-in);flex-wrap:wrap;flex:none}
.hd h2{font-size:15px}
.hd .meta{display:flex;gap:16px;color:var(--mute);flex-wrap:wrap;margin-top:4px}
.hd .r{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sub{color:var(--mute)}
.row{padding:12px 16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;cursor:pointer;width:100%;color:inherit;border-bottom:1px solid var(--line-row);align-items:baseline}
.row:hover{background:var(--hover)}
.row.on{background:var(--sel);box-shadow:inset 2px 0 0 var(--ink)}
.row .a{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .t{color:var(--faint);white-space:nowrap}
.row .b{grid-column:1/-1;color:var(--mute);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.flag{color:var(--need-ink);border:1px solid var(--need);border-radius:5px;padding:1px 7px;white-space:nowrap}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));border-bottom:1px solid var(--line-in);margin:0;flex:none}
.stats>div{padding:12px 18px;border-right:1px solid var(--line-in)}
.stats>div:last-child{border-right:0}
.stats dt{color:var(--mute);margin:0}
.stats dd{margin:2px 0 0;font-size:15px;font-weight:600}
.pane{padding:18px 22px}
.pane+.pane{border-top:1px solid var(--line-in)}
.eyebrow{display:block;color:var(--mute);font-weight:600;margin-bottom:9px}
.hist>div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:14px;padding:11px 0}
.hist>div+div{border-top:1px solid var(--line-row)}
.hist .m{color:var(--mute);line-height:1.5}
.hist .m b{display:block;font-weight:600;color:var(--ink-2)}
.hist .x{line-height:1.5}
.wrote{margin-top:6px;display:flex;gap:10px;align-items:center;color:var(--mute)}
.wrote>span:first-child{flex:1;min-width:0}
.fact-card{border:1px solid var(--line);border-radius:var(--r-ctl);padding:10px 12px}
.fact-card+.fact-card{margin-top:8px}
.fact-card .lab{color:var(--mute)}
.fact-card .val{font-weight:600;margin-top:1px}
.qrow2{padding:18px 22px;border-bottom:1px solid var(--line-row);display:flex;align-items:center;gap:20px;width:100%;color:inherit}
.qrow2:last-child{border-bottom:0}
.qrow2:hover{background:var(--hover)}
.qrow2.on{background:var(--sel);box-shadow:inset 2px 0 0 var(--ink)}
.qrow2 .n{width:74px;flex:none;font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.qrow2 .n.dim{font-size:13px;color:var(--faint);width:auto;min-width:74px;white-space:nowrap}
.qrow2 .l{font-size:15px;font-weight:600}
.qrow2 .s{color:var(--mute);line-height:1.45;margin-top:2px}
.qitem{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:14px;padding:10px 18px;align-items:center;border-bottom:1px solid var(--line-row)}
.qitem .l{font-weight:600}
.qitem .d{color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qitem .c{display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.qitem select,.qitem input{min-height:30px;padding:0 8px}

/* ---- the trace: what a call said, did and ran ---- */
.trace{padding:6px 0}
.step{display:grid;grid-template-columns:64px minmax(0,1fr);gap:14px;padding:12px 22px;border-bottom:1px solid var(--line-row);align-items:start}
.step:last-child{border-bottom:0}
.step .at{color:var(--faint);font-family:var(--mono);font-variant-numeric:tabular-nums;padding-top:2px}
.role{color:var(--mute);font-weight:600;margin-bottom:2px}
.said{font-size:15px;line-height:1.5}
.toolline{display:flex;align-items:center;gap:9px;width:100%;background:var(--sunk);border:1px solid var(--line-row);border-radius:var(--r-ctl);padding:7px 10px;color:var(--ink-3)}
.toolline:hover{background:var(--hover)}
.toolline.quiet{background:transparent;border-color:transparent;color:var(--mute);padding:5px 10px}
.toolline .caret{color:var(--faint);width:10px;flex:none}
.toolline .fn{font-family:var(--mono);color:var(--ink)}
.toolline .plain{color:var(--mute);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toolline .ms{margin-left:auto;color:var(--faint);white-space:nowrap;font-family:var(--mono)}
.detail{margin:6px 0 2px 19px;padding:9px 12px;border-left:2px solid var(--line);display:flex;flex-direction:column;gap:8px}
.kv2{display:grid;grid-template-columns:74px minmax(0,1fr);gap:10px;align-items:baseline}
.kv2 .k{color:var(--mute)}
.detail .v{color:var(--ink-2);min-width:0}
.detail .pre{white-space:pre-wrap;word-break:break-word}
.detail .think{font-style:italic}
.warnline{color:var(--mute)}
.banner{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--r-ctl);flex-wrap:wrap;background:var(--menu);border:1px solid var(--line)}
.banner .k{font-weight:600;white-space:nowrap}
.banner.handoff{background:var(--need-wash);border-color:var(--need)}
.banner.handoff .k{color:var(--need-ink)}
.banner .auto{color:var(--mute)}
.proof{margin-top:5px;border:1px solid var(--line);border-left:2px solid var(--line-btn);border-radius:var(--r-ctl);padding:8px 10px;color:var(--mute)}
.proof .k{display:block;margin-bottom:2px;font-weight:600}
.proof q{color:var(--ink-2)}
.proof .from{display:block;margin-top:2px;color:var(--faint);font-family:var(--mono)}
.strip{display:flex;gap:16px;align-items:center;padding:10px 22px;border-bottom:1px solid var(--line-in);background:var(--sunk);color:var(--mute);flex-wrap:wrap;flex:none}
.strip .r{margin-left:auto}

/* ---- ticket detail, the case file, the ask dialog ---- */
.det{border-left:2px solid var(--line);padding-left:12px;display:flex;flex-direction:column;gap:9px}
.lab{color:var(--mute);font-weight:600;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.det ol,.det ul,.modal ol.steps,.modal ul.rk,.modal ul.gp{margin:0;padding-left:16px;line-height:1.5;color:var(--ink-2)}
.det li+li,.modal .steps li+li{margin-top:5px}
.tc{display:block;background:var(--dark);color:var(--on-dark);border-radius:var(--r-ctl);padding:6px 10px;overflow-x:auto;font-family:var(--mono);line-height:1.5;white-space:pre;margin-bottom:3px}
.tc i{font-style:normal;color:var(--accent)}
.fact{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;padding:2px 0;align-items:baseline}
.fact .k{color:var(--mute)}
.fact .src{color:var(--faint);margin-left:6px;font-family:var(--mono)}
.close{color:var(--ink-2);line-height:1.5}
.diff{color:var(--ink-2);display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px}
.diff .k{color:var(--mute);font-family:var(--mono)}
.case .slot{padding:12px 18px;border-top:1px solid var(--line-in)}
.case .slot .n{color:var(--mute);font-weight:600;margin-bottom:5px}
.case .slot.hot .n{color:var(--need-ink)}
.case .tldr{font-size:15px;line-height:1.5}
.case .slot ul{margin:0;padding-left:16px;line-height:1.5;color:var(--ink-2)}
.case .said{font-size:13px}
.case .trace{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-ctl);margin-top:8px}
.askin{display:flex;gap:8px;padding:14px 18px;align-items:center}
.askin input{flex:1}
.cond{display:flex;gap:7px;align-items:center;padding:0 18px 8px;flex-wrap:wrap}
.cond .jn{color:var(--mute);width:58px;text-align:right}
.cond .x{color:var(--faint);font-size:15px;line-height:1;padding:2px 6px}
.look{padding:10px 18px;background:var(--sunk);border-top:1px solid var(--line-in);border-bottom:1px solid var(--line-in);color:var(--mute);line-height:1.5}
.look b{color:var(--ink);font-weight:600}
.out{max-height:46vh;overflow:auto}
.sqlbox{padding:10px 18px;font-family:var(--mono);line-height:1.5;color:var(--ink-2);background:var(--sunk);white-space:pre-wrap;word-break:break-word;border-bottom:1px solid var(--line-in)}
.small{color:var(--faint);padding:0 18px 12px;line-height:1.5}
.lnk{color:var(--ink-3);text-decoration:underline;text-underline-offset:3px}
.lnk:hover{color:var(--ink)}
.modal .foot .sg{flex:1;color:var(--ink-2);line-height:1.45}

/* ---- the test line ---- */
.talk{display:flex;flex-direction:column;gap:18px;flex:1;min-height:0}
.talk .lead{max-width:620px;display:flex;flex-direction:column;gap:14px;padding-top:12px}
.talk .lead h2{font-size:22px;line-height:1.25;font-family:var(--serif);font-weight:400;letter-spacing:-.01em}
.talk .lead p{font-size:15px;line-height:1.55;color:var(--ink-3)}
.talk .ctl{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn.big{height:40px;padding:0 22px;font-size:15px;border-radius:8px}
.btn.big.live{background:var(--dark);border-color:var(--dark);color:var(--on-dark)}
.convo{padding:18px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.say{display:grid;grid-template-columns:58px minmax(0,1fr);gap:14px;align-items:baseline}
.say .who{color:var(--mute);font-weight:600;padding-top:2px}
.say .words{font-size:15px;line-height:1.5}
.say.caller .words{color:var(--ink-2)}
.doing{display:flex;align-items:center;gap:9px;margin-left:72px;color:var(--ink-2);background:var(--sunk);border:1px solid var(--line-row);border-radius:var(--r-ctl);padding:6px 10px}
.doing .lbl{font-weight:600;color:var(--mute);white-space:nowrap}
.doing .ms{margin-left:auto;color:var(--faint);font-family:var(--mono)}
.doing.held{background:var(--need-wash);border-color:var(--need)}
.doing.held .lbl{color:var(--need-ink)}
.convo-foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line-in);background:var(--sunk);flex-wrap:wrap;flex:none;color:var(--mute)}

/* ---- dialogs, the escalation card, the toast ---- */
.veil{position:fixed;inset:0;background:rgba(26,25,23,.4);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100;overscroll-behavior:contain}
.modal{background:var(--card);border-radius:var(--r-panel);max-width:460px;width:100%;box-shadow:0 8px 26px rgba(0,0,0,.22);max-height:calc(100dvh - 40px);overflow-y:auto;overscroll-behavior:contain}
.modal.wide{max-width:780px}
.modal .body{padding:18px;display:flex;flex-direction:column;gap:12px}
.modal h3{font-size:15px}
.modal label{display:flex;flex-direction:column;gap:5px;color:var(--mute)}
.modal .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.modal .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.modal .foot{padding:12px 18px;border-top:1px solid var(--line-in);display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.modal .foot .l{margin-right:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.modal .menu{padding:0 18px 12px}
.err{padding:9px 12px;border-radius:var(--r-ctl);background:var(--menu);border:1px solid var(--line);color:var(--ink);line-height:1.45}
.modal .sub{color:var(--mute);line-height:1.5}
.gate{max-width:420px;padding:60px 24px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.gate h2{font-size:22px;font-family:var(--serif);font-weight:400;letter-spacing:-.01em}
.gate input{width:100%}
.pop{position:fixed;right:306px;bottom:28px;width:350px;max-width:calc(100vw - 36px);background:var(--card);border:1px solid var(--line);border-radius:var(--r-panel);box-shadow:0 8px 26px rgba(0,0,0,.22);z-index:90;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.pop .ti{font-size:15px;font-weight:600;line-height:1.35}
.pop .su{color:var(--mute);line-height:1.45}
.pop .a{display:flex;gap:7px;margin-top:6px;flex-wrap:wrap}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--dark);color:var(--on-dark);border-radius:var(--r-panel);padding:12px 16px;display:flex;align-items:center;gap:16px;box-shadow:0 8px 26px rgba(0,0,0,.22);z-index:95;max-width:min(600px,92vw)}
.toast button{color:var(--on-dark);font-weight:600;border-bottom:1px solid rgba(244,241,235,.45);white-space:nowrap;flex:none}
.toast button:disabled{opacity:.6}

/* narrow: the rail gives way first, then the sidebar folds to its icons */
@media(max-width:1180px){
  .console{grid-template-columns:196px minmax(0,1fr) 0}
  .rail{display:none}
  .topbar{grid-column:2/3}
  .pop{right:18px}
}
@media(max-width:900px){
  .console{grid-template-columns:60px minmax(0,1fr) 0}
  .side{padding:16px 8px}
  .brand b,.nav a .lb,.nav .ct,.side .who .lb{display:none}
  .nav a{justify-content:center;padding:8px}
  .split{grid-template-columns:1fr}
  .board{min-width:860px}
}
</style>
</head>
<body>
<!-- The shell: sidebar | top bar | main | rail, on one 100dvh grid. The three
     chrome regions are painted by renderChrome(); the main column by render(). -->
<div class="console" id="console">
  <aside class="side" id="side" aria-label="Screens"></aside>
  <header class="topbar" id="topbar"></header>
  <main class="main" id="root"><div class="skel">Loading</div></main>
  <aside class="rail" id="rail" aria-label="On the line and next up"></aside>
</div>
<div id="overlay"></div>
<div id="pop"></div>
<div id="toast"></div>

<script>
"use strict";
/* ---------------------------------------------------------------------------
   One file, no framework, no build step.
   The reason is the same one that kept a framework out of the request handler:
   two adapters were tried on this deployment and both failed only once shipped,
   one of them by never responding at all. A screen that cannot load is a demo
   that does not happen, and there is nothing here a framework would make
   safer.
--------------------------------------------------------------------------- */

/* The shared key, written in by the server from APP_PASSPHRASE when it serves
   this page, so changing the environment variable cannot leave the screen
   holding a stale one. */
var DEFAULT_KEY = "__APP_KEY__";

/* The key comes from the link. There is no passphrase screen: this is one shared
   link for one office, and a form that only ever takes one word was a doorstep
   in front of an unlocked door. The SERVER still requires the key on every
   route — removing the screen removed a step, not the check. */
var KEY = new URLSearchParams(location.search).get("k") || sessionStorage.getItem("fd_key") || DEFAULT_KEY;
if (KEY) sessionStorage.setItem("fd_key", KEY);

/* The sidebar: six screens, labelled. Pressing is not a screen any more; it is
   the rail's "Next up", and #pressing still routes to the full list. Job is a
   detail screen reached from the board, a call or a ticket. */
var NAV = [
  { id: "today",   label: "Dispatch",      icon: "board" },
  { id: "tickets", label: "Tickets",       icon: "list" },
  { id: "calls",   label: "Calls",         icon: "phone" },
  { id: "property",label: "Locations",     icon: "home" },
  { id: "test",    label: "Test line",     icon: "mic" }
];
var TITLES = {
  today: "Dispatch", pressing: "Next up", tickets: "Tickets", calls: "Calls",
  property: "Locations", job: "Job", catchup: "Catch up", test: "Test line"
};

function remembered(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
/* fd_seg is kept so an older tab's value still parses; the desk's collapsible
   segments are gone, and nothing reads it now. */
var MODES = { board: 1, week: 1, month: 1, list: 1 };
var state = {
  view: "today", arg: null,
  board: null, date: null, techs: [],
  tickets: null, allTickets: null, pressing: null, showRehearsals: false, popup: null,
  mode: MODES[remembered("fd_mode", "board")] ? remembered("fd_mode", "board") : "board",
  range: Number(remembered("fd_range", "7")) || 7,
  schedule: null, listFilter: "", sortKey: "when", sortDir: 1,
  /* the queue on Dispatch and the Tickets screen: which row is open, and
     whether its overflow is showing */
  sel: null, menu: null, ticketTab: null, showIdle: false,
  /* a name, not an account: the platform has one passphrase and says so */
  who: remembered("fd_who", "office"),
  ask: { tab: "question", q: "", res: null, busy: false, showSql: false, ent: "jobs", conds: [{ f: "Status", op: "is", v: "" }] },
  calls: [], callsLoaded: false, call: null, callSearch: "", showDemoCalls: false, showDemoWork: false,
  property: null, job: null, brief: null,
  /* The property register: one page of the book, plus what it was filtered by. */
  props: { rows: [], total: 0, cities: [], loaded: false,
           q: "", city: "", only: "", sort: "address", dir: "asc", offset: 0, limit: 50 },
  queues: [], queueName: null, queueItems: [], queueSummary: [],
  test: { providerCallId: null, events: [], busy: false },
  config: null,
  error: null, live: 0
};

/* --- plumbing ---------------------------------------------------------- */

function api(path, opts) {
  opts = opts || {};
  var url = "/data/" + path + (path.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(KEY);
  return fetch(url, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", "x-app-key": KEY },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function (r) {
    return r.json().then(function (j) {
      /* A 409 is the server declining in plain words ("the technician has
         already started this job"); the message is the answer, shown where
         the person is looking. */
      if (!r.ok) throw new Error(j && j.error ? j.error : "Request failed (" + r.status + ")");
      return j;
    });
  });
}

function el(tag, attrs, kids) {
  var e = document.createElement(tag);
  for (var k in attrs || {}) {
    if (k === "class") e.className = attrs[k];
    else if (k === "html") e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === "on") e[k] = attrs[k];
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function (c) {
    if (c === null || c === undefined || c === false) return;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return e;
}

/* Icons: 16px, 1.4 stroke, currentColor, hand-authored. */
var I = {
  board:'<rect x="2" y="3.2" width="12" height="10.8" rx="1.6"/><path d="M2 6.6h12M5.2 1.8v2.4M10.8 1.8v2.4"/>',
  list:'<path d="M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h7"/>',
  phone:'<path d="M3.4 2.6h2.6l1.1 2.9-1.6 1.1a8.4 8.4 0 0 0 3.9 3.9l1.1-1.6 2.9 1.1v2.6a1 1 0 0 1-1.1 1A11 11 0 0 1 2.4 3.7a1 1 0 0 1 1-1.1Z"/>',
  home:'<path d="M2.4 7 8 2.6 13.6 7"/><rect x="4" y="7" width="8" height="6.4"/>',
  tray:'<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6"/><path d="M2.2 9.2h3.2M10.6 9.2h3.2M5.4 9.2a2.6 2.6 0 0 0 5.2 0"/>',
  mic:'<rect x="6" y="2" width="4" height="7.2" rx="2"/><path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8V14"/>',
  search:'<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  left:'<path d="M10 3L5.5 8 10 13"/>',
  right:'<path d="M6 3l4.5 5L6 13"/>'
};
function ic(name) {
  var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.4");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = I[name];
  return s;
}

var TZ = "America/New_York";
function hhmm(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}
function daystamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
}
function money(cents) {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}
/* The local calendar day of a timestamp, in the company's zone. */
function dayOf(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
/* "HH:MM", 24h, in the company's zone: what a <input type=time> wants. */
function clockOf(iso) {
  var p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  var h = p.find(function (x) { return x.type === "hour"; }).value, m = p.find(function (x) { return x.type === "minute"; }).value;
  return (h === "24" ? "00" : h) + ":" + m;
}
function addDays(dateStr, n) {
  var d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function niceDay(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function spanText(mins) {
  mins = Math.abs(Math.round(mins));
  var h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + "h " + m + "m" : m + " min";
}
/* "in 35 min", "1h 10m past" — arithmetic on a real timestamp, never a rank. */
function urgencyOf(iso) {
  if (!iso) return null;
  var mins = (new Date(iso) - new Date()) / 60000;
  if (mins < 0) return { cls: "late", text: spanText(mins) + " past" };
  if (mins < 60) return { cls: "need", text: "in " + spanText(mins) };
  if (mins < 240) return { cls: "", text: "in " + spanText(mins) };
  return null;
}
function who() { return state.who || "office"; }
function fail(e) { state.error = e && e.message ? e.message : String(e); render(); }
function initials(name) {
  var parts = String(name || "").trim().split(/\\s+/).filter(Boolean);
  var s = parts.map(function (w) { return w.charAt(0); }).join("").slice(0, 2);
  return (s || "?").toUpperCase();
}
function surname(name) {
  var parts = String(name || "").trim().split(/\\s+/);
  return parts[parts.length - 1] || "";
}
function techNames(j) { return (j.technicians || []).map(function (t) { return t.name; }).join(", "); }

/* --- routing ------------------------------------------------------------ */

function go(view, arg) {
  location.hash = "#" + view + (arg ? "/" + arg : "");
}
function readHash() {
  var parts = (location.hash || "#today").slice(1).split("/");
  state.view = parts[0] || "today";
  state.arg = parts[1] || null;
}
window.addEventListener("hashchange", function () { readHash(); load(); });

/* --- loaders ------------------------------------------------------------ */

/* The rail reads the line and the tickets on every screen, so both come with
   every load, not only Dispatch's. */
function loadRail() {
  return Promise.all([api("pressing"), api("tickets")]).then(function (r) {
    state.pressing = r[0]; state.tickets = r[1]; watchEscalations();
  });
}

function load() {
  state.error = null;
  render();
  var v = state.view;
  if (v !== "today") {
    loadRail().then(function () {
      if (v === "pressing" || v === "tickets") { if (!typing()) render(); } else renderChrome();
    }).catch(function (e) { if (v === "pressing") fail(e); });
  }
  if (v === "today") {
    state.date = state.date || todayLocal();
    Promise.all([
      api("board?date=" + state.date), api("technicians"), api("queues"), api("tickets"), api("pressing"),
      state.mode !== "board" ? api("board?from=" + rangeFrom() + "&to=" + rangeEnd()) : Promise.resolve(null)
    ]).then(function (r) {
      state.board = r[0]; state.techs = r[1]; state.queueSummary = r[2]; state.tickets = r[3]; state.pressing = r[4];
      state.schedule = r[5]; state.live = r[0].liveCalls;
      watchEscalations(); render();
    }).catch(fail);
  } else if (v === "pressing") {
    /* loadRail paints it */
  } else if (v === "tickets") {
    Promise.all([api("tickets?status=all"), api("technicians")])
      .then(function (r) { state.allTickets = r[0]; state.techs = r[1]; render(); }).catch(fail);
  } else if (v === "calls") {
    api("calls" + (state.callSearch ? "?search=" + encodeURIComponent(state.callSearch) : ""))
      .then(function (list) {
        state.calls = list; state.callsLoaded = true;
        var pick = state.arg || (list[0] && list[0].id);
        if (!pick) { state.call = null; render(); return; }
        return api("calls/" + pick).then(function (c) { state.call = c; render(); });
      }).catch(fail);
  } else if (v === "property") {
    if (!state.arg) { state.property = null; render(); return; }
    api("property/" + state.arg).then(function (p) { state.property = p; render(); }).catch(fail);
  } else if (v === "job") {
    if (!state.arg) { state.job = null; render(); return; }
    api("job/" + state.arg).then(function (j) { state.job = j; render(); }).catch(fail);
  } else if (v === "catchup") {
    api("queues").then(function (q) {
      state.queues = q; state.queueSummary = q;
      if (!state.queueName) { state.queueItems = []; render(); return; }
      return api("queues/" + state.queueName).then(function (items) { state.queueItems = items; render(); });
    }).catch(fail);
  } else {
    render();
  }
}

/* Live refresh. A short poll rather than a push channel: one office, one
   screen, a handful of concurrent calls. */
var tick = 0;
/* True while the person is typing into something on the page itself. A
   redraw under a half-typed filter is how a keystroke goes missing. */
function typing() {
  var a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && document.getElementById("root").contains(a));
}
function busyOnPage() { return draggingId !== null || typing() || !!document.getElementById("overlay").firstChild; }
setInterval(function () {
  if (document.hidden) return;
  tick += 1;
  if (state.view === "today" && state.board) {
    api("board?date=" + state.date).then(function (b) {
      state.board = b; state.live = b.liveCalls;
      if (!busyOnPage()) render();
    }).catch(function () {});
    if (state.mode !== "board") {
      api("board?from=" + rangeFrom() + "&to=" + rangeEnd()).then(function (s) { state.schedule = s; }).catch(function () {});
    }
  } else if (state.view === "calls" && state.call) {
    api("calls").then(function (l) { state.calls = l; state.live = l.filter(function (c) { return c.status === "live"; }).length; });
    if (state.call.status === "live") {
      api("calls/" + state.call.id).then(function (c) { state.call = c; render(); }).catch(function () {});
    }
  }
  /* The line and the tickets ride the same poll, on every screen: the rail and
     the escalation card have to be right wherever the person is.

     Every other tick when the phone is quiet, and EVERY tick while somebody is
     on the line. Five seconds is a long time to stand in front of a screen
     waiting for a handoff to appear, and it is the one moment a person is
     actually watching. When nothing is happening the slower poll is plenty. */
  if (tick % 2 === 0 || state.live > 0) {
    api("pressing").then(function (p) {
      state.pressing = p; watchEscalations();
      if (state.view === "pressing") { if (!busyOnPage()) render(); } else renderChrome();
    }).catch(function () {});
    api("tickets").then(function (t) { state.tickets = t; if (state.view === "today" && !busyOnPage()) render(); else renderChrome(); }).catch(function () {});
    if (state.view === "tickets") api("tickets?status=all").then(function (t) { state.allTickets = t; if (!busyOnPage()) render(); }).catch(function () {});
  }
}, 2500);

setInterval(function () {
  var c = document.getElementById("clock");
  if (c) c.textContent = clockText();
}, 1000);

/* --- chrome ------------------------------------------------------------- */
/* Sidebar, top bar and rail. All three are rebuilt on every render, and the
   rail alone when its feeds poll. Focus on a chrome control survives a
   rebuild by id, and the rail keeps its scroll position across one. */

function openProposals() {
  return (state.tickets || []).filter(function (t) { return t.type === "proposal" && t.status === "open"; });
}
function queueTotal() {
  var n = 0;
  (state.queueSummary || []).forEach(function (q) { if (!q.pending) n += q.count || 0; });
  return n;
}
function visiblePressing() {
  var all = state.pressing || [];
  return state.showRehearsals ? all : all.filter(function (p) { return !p.rehearsal; });
}
function liveCalls() { return visiblePressing().filter(function (p) { return p.kind === "live"; }); }
/* Live calls. Pressing is the one feed polled on every screen, so it is the
   source once it has loaded. */
function liveCount() {
  if (state.pressing) return liveCalls().length;
  return state.live || 0;
}
/* What is next up: everything waiting on a person that is not a live call.
   On Dispatch and on the Tickets screen the open tickets are already the
   queue in the main column, so they are left out of the rail there. */
function nextUp() {
  var onQueueScreen = state.view === "today" || state.view === "tickets";
  return visiblePressing().filter(function (p) {
    if (p.kind === "live") return false;
    if (p.kind === "ticket" && onQueueScreen) return false;
    return true;
  });
}
function clockText() {
  return new Date().toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

/* Scroll positions of a region and the scrollers inside it, by document
   order, so a rebuilt region lands where the eye left it. */
var SCROLLERS = ".scroll,.scrollx,.bd-wrap,.wk-b,.out,.convo,.split>*";
function snap(host) {
  var out = [[host.scrollTop, host.scrollLeft]];
  var ns = host.querySelectorAll(SCROLLERS);
  for (var i = 0; i < ns.length; i++) out.push([ns[i].scrollTop, ns[i].scrollLeft]);
  return out;
}
function unsnap(host, pos) {
  host.scrollTop = pos[0][0]; host.scrollLeft = pos[0][1];
  var ns = host.querySelectorAll(SCROLLERS);
  for (var i = 0; i < ns.length && i + 1 < pos.length; i++) { ns[i].scrollTop = pos[i + 1][0]; ns[i].scrollLeft = pos[i + 1][1]; }
}

function renderChrome() {
  var had = document.activeElement;
  var keepId = had && had.id && !document.getElementById("root").contains(had) ? had.id : null;
  renderSide();
  renderTop();
  renderRail();
  if (keepId) {
    var back = document.getElementById(keepId);
    if (back && document.activeElement !== back) back.focus();
  }
}

/* Six screens, labelled. A count sits at the end of the line only where
   there is something to count; the tickets count is orange because those
   are waiting on a person. */
function renderSide() {
  var host = document.getElementById("side");
  host.innerHTML = "";
  host.appendChild(el("div", { class: "brand" }, [el("span", { class: "mk", "aria-hidden": "true" }, ["GB"]), el("b", {}, ["Front desk"])]));
  var nav = el("nav", { class: "nav", "aria-label": "Screens" });
  var ticketsN = openProposals().length, liveN = liveCount();
  NAV.forEach(function (t) {
    var count = null, said = null;
    if (t.id === "tickets" && ticketsN) { count = el("span", { class: "ct need" }, [String(ticketsN)]); said = t.label + ", " + ticketsN + " waiting on you"; }
    if (t.id === "calls" && liveN) { count = el("span", { class: "livechip ct" }, [el("span", { class: "dot", "aria-hidden": "true" }), "live"]); said = t.label + ", " + liveN + (liveN === 1 ? " call live" : " calls live"); }
    var on = state.view === t.id || (t.id === "today" && state.view === "job") || (t.id === "property" && state.view === "property");
    nav.appendChild(el("a", {
      href: "#" + t.id, class: on ? "on" : "", "aria-label": said, "aria-current": on ? "page" : null, title: t.label
    }, [ic(t.icon), el("span", { class: "lb" }, [t.label]), count]));
  });
  host.appendChild(nav);
  host.appendChild(el("div", { class: "foot" }, [
    el("button", {
      class: "who", id: "whobtn", type: "button", title: "Working as " + who(),
      "aria-label": "Working as " + who() + ". Change your name",
      onclick: function () { whoDialog(); }
    }, [el("span", { class: "av", "aria-hidden": "true" }, [initials(who())]), el("span", { class: "lb" }, [who()])])
  ]));
}

/* The subtitle is the one fact about the screen worth a glance: the day on
   Dispatch, how many are waiting on the Tickets screen. */
function subtitle() {
  switch (state.view) {
    case "today": return "";
    case "tickets": return state.tickets ? openProposals().length + " waiting on you" : "";
    case "pressing": return state.pressing ? nextUp().length + " waiting on a person" : "";
    case "calls": return state.calls.length ? "Latest " + state.calls.length : "";
    case "property": return state.property ? state.property.property.street + (state.property.property.unit ? " unit " + state.property.property.unit : "") : "";
    case "job": return state.job ? (state.job.jobRef ? "Job " + state.job.jobRef : "") : "";
    case "catchup": return state.queues.length ? state.queues.length + " lists" : "";
    default: return "";
  }
}

function renderTop() {
  var t = document.getElementById("topbar");
  t.innerHTML = "";
  t.appendChild(el("h1", {}, [TITLES[state.view] || "Front desk"]));
  var s = subtitle();
  if (s) t.appendChild(el("span", { class: "sub" }, [s]));
  t.appendChild(el("button", {
    class: "ask", id: "askbtn", type: "button", "aria-keyshortcuts": "Meta+K Control+K", title: "Find a record (⌘K)",
    onclick: function () { askDialog(); }
  }, [ic("search"), el("span", {}, ["Find a record"]), el("kbd", { "aria-hidden": "true" }, ["⌘K"])]));
  t.appendChild(el("span", { id: "clock", class: "clock mono" }, [clockText()]));
}

/* The rail: who is on the line, and what is next up. Live state only. It
   never draws the ticket queue, which is the main column's. */
function renderRail() {
  var host = document.getElementById("rail");
  var pos = snap(host);
  host.innerHTML = "";
  var live = state.pressing ? liveCalls() : [];
  host.appendChild(el("div", { class: "rail-h" }, [
    live.length ? el("span", { class: "dot", "aria-hidden": "true" }) : null,
    el("h2", {}, ["On the line"]),
    el("span", { class: "n" }, [state.pressing ? String(live.length) : ""])
  ]));
  var body = el("div", { class: "rail-b" });
  if (!state.pressing) body.appendChild(el("div", { class: "dim" }, ["Reading the line"]));
  else if (!live.length) body.appendChild(el("div", { class: "dim" }, ["Nobody on the line."]));
  else live.forEach(function (p) { body.appendChild(liveCard(p)); });
  host.appendChild(body);

  var nx = nextUp();
  var sec = el("div", { class: "rail-sec" });
  sec.appendChild(el("div", { class: "rail-h" }, [
    el("h2", {}, [el("a", { href: "#pressing", title: "Everything next up" }, ["Next up"])]),
    el("span", { class: "n" }, [state.pressing ? String(nx.length) : ""])
  ]));
  if (!state.pressing) sec.appendChild(el("div", { class: "dim" }, ["Reading"]));
  else if (!nx.length) sec.appendChild(el("div", { class: "dim" }, ["Clear."]));
  else nx.slice(0, 8).forEach(function (p) { sec.appendChild(nextRow(p)); });
  if (nx.length > 8) sec.appendChild(el("a", { class: "dim", href: "#pressing", style: "padding:7px 0" }, [(nx.length - 8) + " more"]));
  host.appendChild(sec);
  host.appendChild(el("div", { class: "rail-foot" }, ["Follow-ups with a date and tickets near their deadline arrive here."]));
  unsnap(host, pos);
}

/* A live call: who, where, why, and the two things a person can do. */
function liveCard(p) {
  return el("div", { class: "lc" }, [
    el("b", {}, [p.title]),
    el("div", { class: "m" }, [
      [(p.channel === "web" ? "Test line" : "Phone"), "since " + hhmm(p.at), p.reasonLabel].filter(Boolean).join(" · ")
    ]),
    el("div", { class: "a" }, [
      el("button", { class: "btn small key", type: "button", onclick: function () { caseFile(p); } }, ["Case file"]),
      p.callId ? el("button", { class: "btn small", type: "button", onclick: function () { go("calls", p.callId); } }, ["Open call"]) : null
    ])
  ]);
}

/* One line in the rail: a dot, the ask, a time. Overdue is the darkened
   accent; everything else waiting on a person is the accent. */
function nextRow(p) {
  var whenText = p.at ? when(p.at) : "";
  return el("button", { class: "nx", type: "button", title: [p.title, p.reasonLabel, p.detail, p.summary ? trunc(p.summary, 120) : ""].filter(Boolean).join(" · "),
    onclick: function () { openPressing(p); } }, [
    el("span", { class: "dot6" + (p.urgency === "now" ? " late" : ""), "aria-hidden": "true" }),
    el("span", { class: "t" }, [p.title + (p.reasonLabel ? " · " + p.reasonLabel : "")]),
    el("span", { class: "tm" }, [whenText])
  ]);
}

function openPressing(p) {
  if (p.kind === "live" || p.kind === "callback") caseFile(p);
  else if (p.kind === "ticket") { state.ticketTab = "open"; state.sel = "t" + p.ticketId; state.menu = null; if (state.view === "tickets") render(); else go("tickets"); }
  else if (p.jobId) go("job", p.jobId);
  else pressingDoneDialog(p);
}

/* --- the toast, and undo ------------------------------------------------ */
/* Every write raises the toast. When the write returned change records, the
   toast carries a working Undo: each change is sent back, newest first. */
var toastTimer = null;
function toast(msg, undoIds) {
  var host = document.getElementById("toast");
  host.innerHTML = "";
  clearTimeout(toastTimer);
  if (!msg) return;
  var box = el("div", { class: "toast", role: "status" }, [el("span", {}, [msg])]);
  var canUndo = undoIds && undoIds.length;
  if (canUndo) {
    var b = el("button", { type: "button" }, ["Undo"]);
    b.onclick = function () { undoChanges(undoIds, b); };
    box.appendChild(b);
  }
  host.appendChild(box);
  toastTimer = setTimeout(function () { host.innerHTML = ""; }, canUndo ? 9000 : 4200);
}
function undoChanges(ids, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Undoing"; }
  var p = Promise.resolve();
  ids.slice().reverse().forEach(function (id) {
    p = p.then(function () { return api("actions/undo", { method: "POST", body: { changeId: id, by: who() } }); });
  });
  return p.then(function () { toast("Undone."); load(); })
    .catch(function (e) { toast("Could not undo. " + e.message); });
}
/* After a write: say what happened, offer Undo, and re-read the record so the
   screen shows what is true rather than what was hoped. */
function wrote(msg, changes) {
  var ids = (changes || []).filter(Boolean).map(function (c) { return c.changeId; }).filter(Boolean);
  toast(msg, ids);
  load();
}

/* A name, not an account: the platform has one passphrase and says so. */
function whoDialog() {
  var input = el("input", {
    id: "who", name: "who", autocomplete: "name", placeholder: "Your name",
    value: state.who === "office" ? "" : state.who, "aria-describedby": "who-help"
  });
  function save() {
    state.who = input.value.trim() || "office";
    try { localStorage.setItem("fd_who", state.who); } catch (e) { /* private mode */ }
    overlay(null); renderChrome();
  }
  input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } };
  overlay(el("div", { class: "veil", onclick: function (e) { if (e.target === this) overlay(null); } }, [
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Working as"]),
        el("label", { for: "who" }, ["Your name", input]),
        el("span", { id: "who-help", class: "sub" }, ["Your name goes on every change you make."])
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: save }, ["Save"])
      ])
    ])
  ]));
}

/* --- the board ---------------------------------------------------------- */

var START_HOUR = 7, END_HOUR = 20, CELLS = (END_HOUR - START_HOUR) * 2;
var draggingId = null;

function cellFor(iso) {
  var d = new Date(iso);
  var parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d);
  var h = Number(parts.find(function (p) { return p.type === "hour"; }).value);
  var m = Number(parts.find(function (p) { return p.type === "minute"; }).value);
  return (h - START_HOUR) * 2 + (m >= 30 ? 1 : 0);
}
function isoForCell(dateStr, cell) {
  return zonedISO(dateStr, clockForCell(cell));
}
/* A wall-clock time in the company's zone, as an instant. The browser may be
   anywhere; the office is in one place, and every job in the book is kept in
   that zone. Two passes, so the day a clock changes still lands right. */
function zonedISO(dateStr, timeStr) {
  var want = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)), Number(timeStr.slice(0, 2)), Number(timeStr.slice(3, 5)));
  var guess = want;
  for (var i = 0; i < 2; i++) {
    var p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    var g = function (t) { return Number(p.find(function (x) { return x.type === t; }).value); };
    var seen = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
    guess = guess - (seen - want);
  }
  return new Date(guess).toISOString();
}
function clockForCell(cell) {
  var h = START_HOUR + Math.floor(cell / 2);
  return (h < 10 ? "0" : "") + h + ":" + (cell % 2 ? "30" : "00");
}
function ymd(d) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function minutesBetween(a, b) {
  if (!a || !b) return null;
  var m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m > 0 ? m : null;
}

/* Late: marked late by a person or the agent, or past the promised window
   and not started. One word for both, because that is what it is. */
function isLate(j) {
  if (j.isCanceled || j.completedAt) return false;
  if (j.lateMinutes) return true;
  return !!(j.scheduledEnd && !j.startedAt && new Date(j.scheduledEnd) < new Date());
}
function nobodyOn(j) { return !j.employeeId && !(j.technicians && j.technicians.length); }

/* The mark a job earns, which is the board's whole colour budget: nobody
   assigned needs a human (orange), late is the hatch, canceled is struck
   through, and a normal job gets nothing. Who booked it is text, in the
   tooltip and on the job page, never a colour. */
function jobTone(j) {
  var tone = "";
  if (j.isCanceled) tone = " stop";
  else if (nobodyOn(j)) tone = " need";
  else if (isLate(j)) tone = " late";
  /* WHO PUT THIS HERE. A corner fold, not a colour: orange already means
     "needs a human" and red means damage, and a third hue would break the one
     rule that makes this board readable. The fold says the agent booked or
     moved it — a fact about provenance, not about urgency, so it must not
     compete with either. */
  return tone + (j.byAgent ? " byagent" : "");
}

function whoBooked(j) {
  if (j.agentLive) return "the agent is on a call about this job now";
  if (j.byAgent) return "booked or changed by the agent on a call";
  return "";
}
function jobTitle(j) {
  var when = j.scheduledStart ? hhmm(j.scheduledStart) + (j.scheduledEnd ? " to " + hhmm(j.scheduledEnd) : "") : "no time yet";
  return [j.jobRef ? "Job " + j.jobRef : "Job " + j.id, j.customer || "No customer", j.address ? j.address + (j.unit ? " #" + j.unit : "") : "",
    j.description || "", when, techNames(j) || (nobodyOn(j) ? "nobody assigned" : ""),
    j.lateMinutes ? j.lateMinutes + " min late" : (isLate(j) ? "past the window" : ""), j.isCanceled ? "canceled" : "", whoBooked(j)]
    .filter(Boolean).join(" · ");
}

function jobBlock(j) {
  var start = j.scheduledStart ? cellFor(j.scheduledStart) : 0;
  var end = j.scheduledEnd ? cellFor(j.scheduledEnd) : start + 2;
  start = Math.max(0, Math.min(CELLS - 1, start));
  var span = Math.max(1, Math.min(CELLS - start, end - start));

  /* The label is who and where, not the job reference. The axis already says
     the time, so the time is the one thing not worth printing. */
  var whoName = j.customer || "No customer";
  var where = (j.address || "").replace(/^\\d+\\s+/, "");
  var kids = [el("b", {}, [whoName])];
  if (where) kids.push(el("span", {}, [where + (j.unit ? " #" + j.unit : "")]));

  /* POINTER DRAG, NOT HTML5 DRAG.
     These blocks are <button>s so the keyboard can reach them, and a browser
     will not reliably start a native drag from a button — draggable="true" was
     set, the drop targets were wired, and dragging a block did nothing at all.
     Pointer events work on a button, work on a touchscreen, and let the block
     follow the finger instead of showing the browser's ghost image. */
  var b = el("button", {
    type: "button", class: "job" + jobTone(j) + (span <= 2 ? " narrow" : ""),
    style: "grid-column:" + (start + 1) + "/span " + span,
    title: jobTitle(j), "aria-label": jobTitle(j),
    onclick: function () { if (!b.__dragged) jobDialog(j); }
  }, kids);
  b.onpointerdown = function (ev) { startBlockDrag(ev, b, j); };
  return b;
}

/* How far the pointer must travel before this counts as a drag rather than a
   click. Below it, a shaky hand still opens the job. */
var DRAG_SLOP = 5;

function startBlockDrag(ev, node, j) {
  if (ev.button !== 0 && ev.pointerType === "mouse") return;
  node.__dragged = false;
  var x0 = ev.clientX, y0 = ev.clientY, on = false, target = null;

  function paintTarget(el2) {
    if (target && target !== el2) target.classList.remove("over");
    target = el2;
    if (target) target.classList.add("over");
  }

  /* elementsFromPoint, PLURAL. The drop cells and the job blocks are two layers
     stacked in the same grid cell (.lane and .blocks both sit at grid-row 1,
     column 2/-1), and .blocks is painted last — so elementFromPoint always
     returned the blocks layer and a walk up from it never found a .drop. The
     plural call returns the whole stack under the pointer, drop cell included. */
  function cellUnder(x, y) {
    var stack = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].classList && stack[i].classList.contains("drop")) return stack[i];
    }
    return null;
  }

  function move(e) {
    if (!on && (Math.abs(e.clientX - x0) > DRAG_SLOP || Math.abs(e.clientY - y0) > DRAG_SLOP)) {
      on = true; node.__dragged = true; draggingId = j.id;
      node.classList.add("dragging");
      document.body.classList.add("dragging-job");
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* older browser */ }
    }
    if (!on) return;
    e.preventDefault();
    paintTarget(cellUnder(e.clientX, e.clientY));
  }

  function up(e) {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
    document.removeEventListener("keydown", esc);
    node.classList.remove("dragging");
    document.body.classList.remove("dragging-job");
    draggingId = null;
    if (!on) return;
    var cell = cellUnder(e.clientX, e.clientY);
    paintTarget(null);
    if (!cell) return;
    var c = Number(cell.getAttribute("data-cell"));
    var date = cell.getAttribute("data-date");
    var empRaw = cell.getAttribute("data-emp");
    var emp = empRaw === "" ? null : Number(empRaw);
    moveAndAssign(j.id, isoForCell(date, c), emp);
    /* The click that follows a drag is not a request to open the job. */
    setTimeout(function () { node.__dragged = false; }, 0);
  }

  function cancel() { on = false; up({ clientX: -1, clientY: -1 }); }
  function esc(e) { if (e.key === "Escape") { on = false; cancel(); } }

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", esc);
}

/* Where a technician was last known to be. Geography decides every release in
   this business. */
function lastSeen(row) {
  var done = row.jobs.filter(function (j) { return j.completedAt || j.startedAt; });
  var j = done[done.length - 1];
  if (!j || !j.address) return null;
  return "last at " + j.address.replace(/^\\d+\\s+/, "");
}

function boardRow(row, date) {
  var lane = el("div", { class: "lane" });
  for (var i = 0; i < CELLS; i++) lane.appendChild(el("i", { class: "tick" }));

  /* Every empty half hour is a drop target, and a click on one books a job
     at that time on that technician. */
  var drops = el("div", { class: "blocks" });
  for (var c = 0; c < CELLS; c++) {
    (function (cell) {
      drops.appendChild(el("div", {
        class: "drop", style: "grid-column:" + (cell + 1) + "/span 1",
        /* The coordinates live on the element so a pointer drag can find its
           target with elementFromPoint instead of re-deriving the geometry. */
        "data-cell": String(cell), "data-date": date,
        "data-emp": row.employeeId === null || row.employeeId === undefined ? "" : String(row.employeeId),
        title: "Book " + hhmm(isoForCell(date, cell)) + (row.employeeId ? " with " + row.name : ""),
        onclick: function () { bookDialog({ date: date, time: clockForCell(cell), employeeId: row.employeeId }); },
        ondragover: function (ev) { ev.preventDefault(); this.classList.add("over"); },
        ondragleave: function () { this.classList.remove("over"); },
        ondrop: function (ev) {
          ev.preventDefault(); this.classList.remove("over");
          var id = Number(ev.dataTransfer.getData("text/plain"));
          if (!id) return;
          moveAndAssign(id, isoForCell(date, cell), row.employeeId);
        }
      }));
    })(c);
  }

  var blocks = el("div", { class: "blocks" });
  row.jobs.forEach(function (j) { blocks.appendChild(jobBlock(j)); });

  var behind = 0;
  row.jobs.forEach(function (j) { behind = Math.max(behind, j.lateMinutes || 0); });
  var sub = behind
    ? el("span", { class: "late" }, [behind + " min behind"])
    : el("span", {}, [lastSeen(row) || (row.jobs.length ? row.jobs.length + (row.jobs.length === 1 ? " job" : " jobs") : "free")]);

  return el("div", { class: "grow tech" + (row.employeeId === null ? " unrow" : ""), role: "row" }, [
    el("div", { class: "rl" }, [el("b", {}, [row.employeeId === null ? "Nobody assigned" : row.name]), sub]),
    lane, drops, blocks
  ]);
}

function techName(id) {
  var t = (state.techs || []).filter(function (x) { return x.id === id; })[0];
  return t ? t.name : null;
}

/* A drag is a move, and a change of lane is also a reassignment. The duration
   travels with the move so a two-hour visit stays two hours. */
function moveAndAssign(jobId, startsAt, employeeId) {
  var current = null, dur = null, found = null;
  state.board.rows.forEach(function (r) {
    r.jobs.forEach(function (j) { if (j.id === jobId) { found = j; current = j.employeeId; dur = minutesBetween(j.scheduledStart, j.scheduledEnd); } });
  });
  var changes = [];
  var body = { jobId: jobId, startsAt: startsAt, by: who() };
  if (dur) body.durationMinutes = dur;
  api("actions/move", { method: "POST", body: body })
    .then(function (c) {
      changes.push(c);
      if (current !== employeeId) {
        return api("actions/assign", { method: "POST", body: { jobId: jobId, employeeId: employeeId, by: who() } })
          .then(function (c2) { changes.push(c2); });
      }
    })
    .then(function () {
      var msg = "Moved " + (found && found.customer ? found.customer : "the job") + " to " + hhmm(startsAt);
      if (current !== employeeId) msg += employeeId === null ? ", nobody assigned" : ", now with " + (techName(employeeId) || "someone else");
      wrote(msg + ".", changes);
    })
    .catch(function (e) { toast("Not moved. " + e.message); load(); });
}

function shiftDay(n) {
  if (state.mode === "month") {
    var d = new Date(state.date + "T12:00:00");
    d.setDate(1); d.setMonth(d.getMonth() + n);
    state.date = ymd(d);
  } else {
    state.date = addDays(state.date, n);
  }
  load();
}

function boardGrid(b) {
  var hours = el("div", { class: "grow axis", role: "row" }, [el("div", { class: "rl" }, [el("b", {}, ["Technician"])])]);
  for (var h = START_HOUR; h < END_HOUR; h++) {
    var lab = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "a" : "p");
    hours.appendChild(el("div", { class: "hcell" }, [lab]));
  }
  var board = el("div", { class: "board", role: "table", "aria-label": "Board for " + niceDay(b.date) }, [hours]);

  /* Row zero first: the one row where something waits on a decision rather
     than on a technician. Then the crew, alphabetical, so a name is always in
     the same place. */
  var un = b.rows.filter(function (r) { return r.employeeId === null; });
  var busy = b.rows.filter(function (r) { return r.employeeId !== null; });
  un.forEach(function (r) { board.appendChild(boardRow(r, b.date)); });
  busy.forEach(function (r) { board.appendChild(boardRow(r, b.date)); });

  var working = {};
  busy.forEach(function (r) { working[r.employeeId] = true; });
  var idle = (state.techs || []).filter(function (t) { return !working[t.id]; });
  /* Everyone with nothing on is one line in the foot, unless the person has
     opened them up to drop a job on a free lane. */
  if (state.showIdle) idle.forEach(function (t) { board.appendChild(boardRow({ employeeId: t.id, name: t.name, jobs: [] }, b.date)); });
  if (!busy.length && !un.length && !state.showIdle) board.appendChild(el("div", { class: "empty" }, ["Nothing booked."]));

  /* The now line, drawn only on the day it is actually true. */
  if (b.date === todayLocal()) {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    var nh = Number(parts.find(function (p) { return p.type === "hour"; }).value);
    var nm = Number(parts.find(function (p) { return p.type === "minute"; }).value);
    var frac = ((nh * 60 + nm) - START_HOUR * 60) / ((END_HOUR - START_HOUR) * 60);
    if (frac > 0 && frac < 1) {
      board.appendChild(el("div", { class: "nowline", "aria-hidden": "true", style: "left:calc(170px + (100% - 170px) * " + frac.toFixed(4) + ")" }));
    }
  }
  return { node: board, idle: idle };
}

/* The foot: who is free, the two marks, and one hint. */
function boardFoot(idle, hint) {
  var kids = [];
  if (idle && idle.length) {
    kids.push(el("button", {
      class: "lnk", type: "button", "aria-expanded": state.showIdle ? "true" : "false",
      title: idle.map(function (t) { return t.name; }).join(", "),
      onclick: function () { state.showIdle = !state.showIdle; render(); }
    }, [idle.length + (idle.length === 1 ? " technician free" : " technicians free") + (state.showIdle ? ", shown" : "")]));
  }
  kids.push(el("span", {}, [el("span", { class: "sw", style: "background:var(--need)", "aria-hidden": "true" }), "needs a human"]));
  kids.push(el("span", {}, [el("span", { class: "sw", style: "background:repeating-linear-gradient(135deg,var(--line-strong) 0 2px,var(--plain) 2px 4px);box-shadow:inset 2px 0 0 var(--late)", "aria-hidden": "true" }), "late"]));
  kids.push(el("span", {}, [el("span", { class: "fold", "aria-hidden": "true" }), "booked by the agent"]));
  if (hint) kids.push(el("span", { class: "r" }, [hint]));
  return el("div", { class: "bd-foot" }, kids);
}

/* --- Dispatch ------------------------------------------------------------ */
/* Top to bottom: the date row, one line of counts, the queue of what is
   waiting on you, and the board, which takes the rest of the height. Every
   number is a row from the record; nothing here is typed by hand. */

function viewToday() {
  if (!state.board) return el("div", { class: "skel" }, ["Loading"]);
  return [dateRow(), sumLine(), queueCard(), scheduleCard()];
}

function scheduleTitle() {
  if (state.mode === "board") return niceDay(state.date);
  if (state.mode === "month") return new Date(state.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return niceDay(rangeFrom()) + " to " + niceDay(rangeEnd());
}

function dateRow() {
  var m = state.mode;
  var step = m === "month" ? 1 : rangeDays();
  var unit = m === "board" ? "day" : m === "week" ? "week" : m === "month" ? "month" : step + " days";
  var isNow = m === "week" ? weekStart(state.date) === weekStart(todayLocal())
    : m === "month" ? state.date.slice(0, 7) === todayLocal().slice(0, 7)
    : state.date === todayLocal();
  function opt(mode, label) {
    return el("button", { class: m === mode ? "on" : "", type: "button", "aria-pressed": m === mode ? "true" : "false",
      onclick: function () { setMode(mode); } }, [label]);
  }
  return el("div", { class: "daterow" }, [
    el("div", { style: "display:flex;gap:6px" }, [
      el("button", { class: "ib", type: "button", "aria-label": "Back one " + unit, title: "Back one " + unit, onclick: function () { shiftDay(-step); } }, [ic("left")]),
      el("button", { class: "ib", type: "button", "aria-label": "Forward one " + unit, title: "Forward one " + unit, onclick: function () { shiftDay(step); } }, [ic("right")])
    ]),
    el("span", { class: "d" }, [scheduleTitle()]),
    isNow ? null : el("button", { class: "btn small", type: "button", onclick: function () { state.date = todayLocal(); load(); } }, ["Today"]),
    el("div", { class: "seg", role: "group", "aria-label": "View" }, [opt("board", "Day"), opt("week", "Week"), opt("month", "Month"), opt("list", "List")]),
    el("div", { class: "grow" }),
    el("button", { class: "btn key", id: "bookbtn", type: "button", onclick: function () { bookDialog({ date: state.date }); } }, ["Book a job"])
  ]);
}

/* Counts for what is on screen: the day, the week, the month or the list. */
function scheduleCounts() {
  var b = state.board;
  if (state.mode === "board") {
    var late = 0, seen = {};
    b.rows.forEach(function (r) { r.jobs.forEach(function (j) { if (seen[j.id]) return; seen[j.id] = 1; if (isLate(j)) late += 1; }); });
    return { jobs: b.counts.jobs, unassigned: b.counts.unassigned, late: late, canceled: b.counts.canceled };
  }
  var s = state.schedule;
  if (!s) return null;
  var jobs = state.mode === "month" ? s.jobs.filter(function (j) { return j.day.slice(0, 7) === state.date.slice(0, 7); }) : s.jobs;
  var c = { jobs: 0, unassigned: 0, late: 0, canceled: 0 };
  jobs.forEach(function (j) {
    c.jobs += 1;
    if (j.isCanceled) c.canceled += 1;
    else if (nobodyOn(j)) c.unassigned += 1;
    if (isLate(j)) c.late += 1;
  });
  return c;
}

function sumLine() {
  var c = scheduleCounts();
  if (!c) return el("div", { class: "sumline" }, [el("span", { class: "sub" }, ["Reading"])]);
  function part(n, word, cls) {
    return el("span", {}, [el("b", { class: n && cls ? cls : "" }, [String(n)]), word]);
  }
  var kids = [part(c.jobs, c.jobs === 1 ? "job" : "jobs", "")];
  if (c.unassigned) kids.push(part(c.unassigned, "nobody assigned", "need"));
  if (c.late) kids.push(part(c.late, "late", "late"));
  if (c.canceled) kids.push(part(c.canceled, "canceled", ""));
  if (state.mode === "board") {
    var working = {};
    state.board.rows.forEach(function (r) { if (r.employeeId !== null) working[r.employeeId] = true; });
    var free = (state.techs || []).filter(function (t) { return !working[t.id]; }).length;
    kids.push(part(free, free === 1 ? "technician free" : "technicians free", ""));
  }
  return el("div", { class: "sumline", "aria-label": "Counts" }, kids);
}

/* What is waiting on you: the open tickets, one line each until selected.
   The rail never repeats this list. */
function queueCard() {
  var open = openProposals();
  var card = el("div", { class: "card" }, [
    el("div", { class: "card-h" }, [
      el("h2", {}, ["Waiting on you"]),
      el("span", { class: "n" }, [state.tickets ? String(open.length) : ""]),
      el("span", { class: "r" }, [el("a", { href: "#tickets" }, ["All tickets ›"])])
    ])
  ]);
  if (!state.tickets) card.appendChild(el("div", { class: "empty" }, ["Reading"]));
  else if (!open.length) card.appendChild(el("div", { class: "empty" }, ["Nothing waiting on you."]));
  else open.slice(0, 5).forEach(function (t) { card.appendChild(ticketRow(t)); });
  if (open.length > 5) card.appendChild(el("div", { class: "empty" }, [el("a", { href: "#tickets", class: "lnk" }, [(open.length - 5) + " more"])]));
  return card;
}

/* The schedule: the board, the week, the month or the list, in a card that
   takes the remaining height and scrolls inside itself. */
function scheduleCard() {
  var card = el("div", { class: "card fill" });
  if (state.mode === "board") {
    var g = boardGrid(state.board);
    card.appendChild(el("div", { class: "bd-wrap" }, [g.node]));
    card.appendChild(boardFoot(g.idle, "Drag a block to move it. Click a gap to book."));
  } else if (state.mode === "week") {
    card.appendChild(weekGrid());
    card.appendChild(boardFoot(null, null));
  } else if (state.mode === "month") {
    card.appendChild(monthGrid());
    card.appendChild(boardFoot(null, "Click a day to open it."));
  } else {
    card.appendChild(listBar());
    card.appendChild(listTable());
  }
  return card;
}

/* --- the week, the month, the list -------------------------------------- */

/* Four ways to see the schedule. Day is the board. Week is seven columns,
   Monday to Sunday. Month is the look-ahead: the whole grid, edge days
   dimmed. List is a table across 7, 14 or 30 days. All but Day read the same
   range endpoint; the day the person is standing on stays put underneath. */
function weekStart(dateStr) {
  var d = new Date(dateStr + "T12:00:00");
  return addDays(dateStr, -((d.getDay() + 6) % 7));
}
function monthWeeks(dateStr) {
  var first = dateStr.slice(0, 8) + "01";
  var d = new Date(first + "T12:00:00");
  var offset = (d.getDay() + 6) % 7;
  var days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.ceil((offset + days) / 7);
}
function rangeDays() {
  if (state.mode === "week") return 7;
  if (state.mode === "list") return state.range;
  if (state.mode === "month") return monthWeeks(state.date) * 7;
  return 1;
}
function rangeFrom() {
  if (state.mode === "week") return weekStart(state.date);
  if (state.mode === "month") return weekStart(state.date.slice(0, 8) + "01");
  return state.date;
}
function rangeEnd() { return addDays(rangeFrom(), rangeDays() - 1); }

function setMode(m) {
  if (m !== state.mode) state.schedule = null;
  state.mode = m;
  try { localStorage.setItem("fd_mode", m); } catch (e) { /* private mode */ }
  load();
}

/* "9a", "9:30a", "12p": the axis's own spelling, for tight cells. */
function shortTime(iso) {
  if (!iso) return "";
  var p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  var h = p.find(function (x) { return x.type === "hour"; }).value, m = p.find(function (x) { return x.type === "minute"; }).value;
  var ap = p.find(function (x) { return x.type === "dayPeriod"; }).value.toLowerCase().charAt(0);
  return h + (m === "00" ? "" : ":" + m) + ap;
}
function byTime(a, b) {
  return String(a.scheduledStart || "").localeCompare(String(b.scheduledStart || "")) || (a.id - b.id);
}
function groupByDay(jobs) {
  var byDay = {};
  jobs.forEach(function (j) { (byDay[j.day] = byDay[j.day] || []).push(j); });
  Object.keys(byDay).forEach(function (k) { byDay[k].sort(byTime); });
  return byDay;
}

/* Seven day columns, the jobs stacked inside each by time. Today is a rule
   and a weight, not a fill. A column head opens that day on the board. */
function weekGrid() {
  var s = state.schedule;
  if (!s) return el("div", { class: "skel" }, ["Reading the week"]);
  var byDay = groupByDay(s.jobs);
  var from = rangeFrom(), today = todayLocal();
  var grid = el("div", { class: "week" });
  for (var i = 0; i < 7; i++) {
    (function (day) {
      var isToday = day === today;
      var jobs = byDay[day] || [];
      var d = new Date(day + "T12:00:00");
      var body = el("div", { class: "wk-b" });
      jobs.forEach(function (j) { body.appendChild(weekBlock(j)); });
      grid.appendChild(el("div", { class: "wk-col" + (isToday ? " today" : ""), role: "group",
        "aria-label": niceDay(day) + (isToday ? ", today" : "") + ", " + jobs.length + (jobs.length === 1 ? " job" : " jobs") }, [
        el("button", { class: "wk-h", type: "button", title: "Open " + niceDay(day) + " on the board",
          onclick: function () { state.date = day; setMode("board"); } }, [
          el("b", {}, [d.toLocaleDateString("en-US", { weekday: "short" })]),
          el("span", {}, [d.toLocaleDateString("en-US", { month: "short", day: "numeric" })]),
          jobs.length ? el("span", { class: "n" }, [String(jobs.length)]) : null
        ]),
        body
      ]));
    })(addDays(from, i));
  }
  return grid;
}

/* One job in a week column: the time, the address, and who has it. */
function weekBlock(j) {
  var where = (j.address || "").replace(/^\\d+\\s+/, "") + (j.unit ? " #" + j.unit : "");
  var techs = j.technicians || [];
  var by = techs.length ? surname(techs[0].name) + (techs.length > 1 ? " +" + (techs.length - 1) : "") : "nobody";
  return el("button", {
    type: "button", class: "job wk" + jobTone(j), title: jobTitle(j), "aria-label": jobTitle(j),
    onclick: function () { jobDialog(j); }
  }, [
    el("span", { class: "tm" }, [j.scheduledStart ? shortTime(j.scheduledStart) : "—"]),
    el("b", {}, [j.customer || where || "No customer"]),
    el("span", { class: "by" }, [[where, by].filter(Boolean).join(" · ")])
  ]);
}

/* The month: seven columns, five or six week rows. Each day shows its date,
   its count, up to three jobs, then "+N more". An empty day stays empty. A
   click opens the day on the board. */
function monthGrid() {
  var s = state.schedule;
  if (!s) return el("div", { class: "skel" }, ["Reading the month"]);
  var byDay = groupByDay(s.jobs);
  var from = rangeFrom(), weeks = monthWeeks(state.date), today = todayLocal(), month = state.date.slice(0, 7);
  var grid = el("div", { class: "month", role: "grid", "aria-label": scheduleTitle(),
    style: "grid-template-rows:auto repeat(" + weeks + ",minmax(96px,1fr));min-height:" + (weeks * 104 + 40) + "px" });
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (d) { grid.appendChild(el("div", { class: "mo-h", role: "columnheader" }, [d])); });
  for (var i = 0; i < weeks * 7; i++) {
    (function (day) {
      var jobs = byDay[day] || [];
      var out = day.slice(0, 7) !== month, isToday = day === today;
      var cell = el("button", {
        type: "button", role: "gridcell", class: "mo-d" + (out ? " out" : "") + (isToday ? " today" : ""),
        "aria-label": niceDay(day) + (isToday ? ", today" : "") + ", " + (jobs.length ? jobs.length + (jobs.length === 1 ? " job" : " jobs") : "nothing booked") + ". Open the day",
        onclick: function () { state.date = day; setMode("board"); }
      }, [
        el("div", { class: "d" }, [el("b", {}, [String(Number(day.slice(8)))]), jobs.length ? el("span", { class: "n" }, [String(jobs.length)]) : null])
      ]);
      jobs.slice(0, 3).forEach(function (j) {
        cell.appendChild(el("div", { class: "mj" + jobTone(j), title: jobTitle(j) }, [
          el("span", { class: "t" }, [j.scheduledStart ? shortTime(j.scheduledStart) : "—"]),
          el("span", { class: "w" }, [j.customer || (j.address || "").replace(/^\\d+\\s+/, "") || "No customer"])
        ]));
      });
      if (jobs.length > 3) cell.appendChild(el("div", { class: "mo-more" }, ["+" + (jobs.length - 3) + " more"]));
      grid.appendChild(cell);
    })(addDays(from, i));
  }
  return grid;
}

/* The one or two words a job's state comes down to, and the mark it earns. */
function statusOf(j) {
  if (j.isCanceled) return { text: "Canceled", cls: "" };
  if (j.completedAt) return { text: "Done", cls: "" };
  if (j.lateMinutes) return { text: j.lateMinutes + " min late", cls: "late" };
  if (j.startedAt) return { text: "Started", cls: "" };
  if (nobodyOn(j)) return { text: "Nobody assigned", cls: "need" };
  if (isLate(j)) return { text: "Past the window", cls: "late" };
  return { text: "Booked", cls: "" };
}

/* Real files, made in the browser from the rows already on screen. */
function download(name, text, type) {
  var blob = new Blob([text], { type: type || "application/json" });
  var url = URL.createObjectURL(blob);
  var a = el("a", { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}
/* One row per step of a call, in the order they happened. Everything the Calls
   screen shows, including what the agent said, what it looked up, the exact
   database question and how long it took. */
function exportCall(c) {
  var rows = c.events.map(function (e) {
    return [
      String(e.seq == null ? "" : e.seq),
      e.at ? hhmm(e.at) : "",
      e.kind || "",
      e.role || "",
      (e.body || e.toolName || "").replace(/\\s+/g, " "),
      (e.statement || "").replace(/\\s+/g, " "),
      e.rowCount == null ? "" : String(e.rowCount),
      e.durationMs == null ? "" : String(e.durationMs)
    ];
  });
  c.changes.forEach(function (ch) {
    rows.push(["", "", "change", "", (ch.jobRef ? "Job " + ch.jobRef + ": " : "") + (ch.summary || ch.kind), "", "", ""]);
  });
  var name = "call-" + c.id + "-" + (c.address || c.fromNumber || "unknown").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  download(name + ".csv",
    toCSV(["Step", "Time", "What", "Who", "Said or looked up", "Database question", "Rows", "ms"], rows),
    "text/csv");
  toast("Saved this call as a CSV file.");
}

/* One backlog, out to a spreadsheet, with whatever the office has already put
   against each row: who owns it and when it is due. */
function exportQueue(q, list) {
  var rows = list.map(function (it) {
    return [
      it.label || "",
      (it.detail || "").replace(/\\s+/g, " "),
      it.amountCents == null ? "" : money(it.amountCents),
      it.ownerName || "",
      it.dueOn || ""
    ];
  });
  download((q ? q.name : "list") + "-" + stamp() + ".csv",
    toCSV(["What", "Detail", "Amount", "Owner", "Due"], rows), "text/csv");
  toast("Saved " + rows.length + " rows as a CSV file.");
}

function toCSV(cols, rows) {
  var q = function (v) { v = v === null || v === undefined ? "" : String(v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.map(q).join(",")].concat(rows.map(function (r) { return r.map(q).join(","); })).join("\\n");
}
function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"); }

/* List mode's own controls: the range, a filter and the export. */
function listBar() {
  var bar = el("div", { class: "bar" }, [
    el("div", { class: "seg", role: "group", "aria-label": "How many days" }, [7, 14, 30].map(function (n) {
      return el("button", { class: state.range === n ? "on" : "", type: "button", "aria-pressed": state.range === n ? "true" : "false",
        onclick: function () { state.range = n; try { localStorage.setItem("fd_range", String(n)); } catch (e) {} load(); } }, [n + " days"]);
    }))
  ]);
  var q = el("input", { type: "search", id: "list-filter", "aria-label": "Filter the list", placeholder: "Filter", value: state.listFilter || "" });
  q.oninput = function () {
    state.listFilter = this.value;
    var body = document.getElementById("list-body");
    if (body) body.replaceWith(listBody());
    var cnt = document.getElementById("list-count");
    if (cnt) cnt.textContent = listCount();
  };
  bar.appendChild(q);
  bar.appendChild(el("span", { class: "r" }, [
    el("span", { id: "list-count", class: "num" }, [listCount()]),
    el("button", { class: "btn small", type: "button", onclick: exportList }, ["Export"])
  ]));
  return bar;
}
function listCount() {
  var s = state.schedule;
  return s ? filteredJobs().length + " of " + s.jobs.length : "";
}

function filteredJobs() {
  var s = state.schedule;
  if (!s) return [];
  var q = (state.listFilter || "").toLowerCase().trim();
  var rows = s.jobs.filter(function (j) {
    if (!q) return true;
    return [j.day, j.customer, j.address, j.unit, j.description, techNames(j), statusOf(j).text, j.jobRef, whoBooked(j)]
      .join(" ").toLowerCase().indexOf(q) >= 0;
  });
  var k = state.sortKey, dir = state.sortDir;
  var val = function (j) {
    switch (k) {
      case "customer": return j.customer || "";
      case "address": return j.address || "";
      case "description": return j.description || "";
      case "tech": return techNames(j);
      case "status": return statusOf(j).text;
      default: return j.scheduledStart || "";
    }
  };
  rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.id - b.id); });
  return rows;
}

var LIST_COLS = [["when", "Day"], ["time", "Time"], ["customer", "Customer"], ["tech", "Technician"], ["status", "Status"], ["address", "Address"], ["description", "What"]];

function listBody() {
  var tbody = el("tbody", { id: "list-body" });
  var rows = filteredJobs();
  if (!rows.length) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: "7", class: "dim" }, [state.schedule ? "Nothing matches." : "Reading"])]));
    return tbody;
  }
  rows.forEach(function (j) {
    var st = statusOf(j);
    tbody.appendChild(el("tr", { title: whoBooked(j) || null, onclick: function () { jobDialog(j); }, tabindex: "0",
      onkeydown: function (e) { if (e.key === "Enter") jobDialog(j); } }, [
      el("td", { class: "dim" }, [niceDay(j.day)]),
      el("td", { class: "mono", title: j.scheduledEnd ? "until " + hhmm(j.scheduledEnd) : null }, [j.scheduledStart ? hhmm(j.scheduledStart) : "no time"]),
      el("td", {}, [j.customer || "No customer"]),
      el("td", { class: "wrap" }, [techNames(j) || el("span", { class: "need" }, ["nobody"])]),
      el("td", {}, [el("span", { class: st.cls }, [st.text])]),
      el("td", { class: "dim wrap" }, [(j.address || "") + (j.unit ? " #" + j.unit : "")]),
      el("td", { class: "wrap" }, [j.description || "Service call"])
    ]));
  });
  return tbody;
}

function listTable() {
  var head = el("tr", {}, LIST_COLS.map(function (c) {
    var key = c[0] === "time" ? "when" : c[0];
    var on = state.sortKey === key;
    return el("th", { "aria-sort": on ? (state.sortDir > 0 ? "ascending" : "descending") : "none" }, [
      el("button", { type: "button", onclick: function () {
        if (state.sortKey === key) state.sortDir = -state.sortDir; else { state.sortKey = key; state.sortDir = 1; }
        render();
      } }, [c[1] + (on ? (state.sortDir > 0 ? " ▴" : " ▾") : "")])
    ]);
  }));
  return el("div", { class: "scrollx" }, [el("table", { class: "list" }, [el("thead", {}, [head]), listBody()])]);
}

function exportList() {
  var rows = filteredJobs().map(function (j) {
    return [j.day, j.scheduledStart ? hhmm(j.scheduledStart) : "", j.customer || "", (j.address || "") + (j.unit ? " #" + j.unit : ""),
      j.description || "", techNames(j), statusOf(j).text, j.jobRef || "", j.byAgent ? "agent" : "office"];
  });
  download("jobs-" + rangeFrom() + "-to-" + rangeEnd() + ".csv",
    toCSV(["Day", "Time", "Customer", "Address", "What", "Technician", "Status", "Job", "Booked by"], rows), "text/csv");
  toast("Saved " + rows.length + " jobs as a CSV file.");
}

/* --- dialogs ------------------------------------------------------------ */

var overlayReturnFocus = null;
/* Trail toggles inside a modal repaint the modal, not the page behind it. */
var traceRepaint = null;

function overlay(node) {
  var host = document.getElementById("overlay");
  var replacing = !!host.firstChild;
  host.innerHTML = "";
  if (!node) traceRepaint = null;
  if (node) {
    /* One dialog opening from another keeps the first opener as the place to
       return to. */
    if (!replacing) {
      var a = document.activeElement;
      overlayReturnFocus = a && a !== document.body ? { node: a, id: a.id || null, label: a.getAttribute("aria-label") || null } : null;
    }
    host.appendChild(node);
    var first = host.querySelector("input, textarea, select, button");
    if (first) first.focus();
  } else if (overlayReturnFocus) {
    var r = overlayReturnFocus;
    overlayReturnFocus = null;
    /* The page may have repainted while the dialog was up, so the opener is
       found again by id or by its label rather than by identity. */
    var back = document.contains(r.node) ? r.node
      : r.id ? document.getElementById(r.id)
      : r.label ? document.querySelector('[aria-label="' + r.label.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"]') : null;
    if (!back) { back = document.getElementById("root"); back.setAttribute("tabindex", "-1"); }
    try { back.focus(); } catch (e) { /* gone */ }
  }
}

/* Escape closes whatever is open, and Tab cannot leave it. */
document.addEventListener("keydown", function (e) {
  var host = document.getElementById("overlay");
  if (!host.firstChild) return;
  if (e.key === "Escape") { overlay(null); return; }
  if (e.key !== "Tab") return;
  var f = Array.prototype.filter.call(host.querySelectorAll("input, textarea, select, button"), function (n) { return !n.disabled && n.offsetParent !== null; });
  if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/**
 * Runs one write behind one submit button. The button disables and its own
 * label becomes the busy state, and a refusal (a 409 in plain words) shows
 * inline, right above the button, not in a banner somewhere else.
 */
function runAction(btn, errNode, busyLabel, run, after) {
  var was = btn.textContent;
  btn.disabled = true; btn.textContent = busyLabel;
  errNode.textContent = ""; errNode.hidden = true;
  run().then(function (r) { overlay(null); if (after) after(r); else load(); }).catch(function (e) {
    btn.disabled = false; btn.textContent = was;
    errNode.textContent = (e && e.message) ? e.message : String(e);
    errNode.hidden = false;
  });
}
function errBox() { return el("div", { class: "err", role: "alert", hidden: true }); }
function veil(kids) {
  return el("div", { class: "veil", onclick: function (e) { if (e.target === this) overlay(null); } }, kids);
}
function localISO(dateStr, timeStr) { return zonedISO(dateStr, timeStr || "09:00"); }

var DURATIONS = [[30, "30 min"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]];
function durationSelect(id, current) {
  var opts = DURATIONS.slice();
  if (current && !opts.some(function (o) { return o[0] === current; })) opts.push([current, spanText(current)]);
  opts.sort(function (a, b) { return a[0] - b[0]; });
  return el("select", { id: id }, opts.map(function (o) {
    return el("option", { value: String(o[0]), selected: o[0] === (current || 120) ? "" : null }, [o[1]]);
  }));
}
function techSelect(id, current) {
  return el("select", { id: id }, [el("option", { value: "" }, ["Nobody"])].concat(
    (state.techs || []).map(function (t) {
      return el("option", { value: String(t.id), selected: t.id === current ? "" : null }, [t.name]);
    })
  ));
}
function labelled(id, text, control) { return el("label", { for: id }, [text, control]); }

/* Book a job. Opened from the Book button, an empty slot on the board, or a
   property page; a slot prefills the day, the time and the technician. */
function bookDialog(pre) {
  pre = pre || {};
  var found = pre.propertyId || null;
  var search = el("input", { id: "bk-addr", type: "search", autocomplete: "off", spellcheck: "false", placeholder: "Street address" });
  var results = el("div", { "aria-live": "polite", style: "display:flex;flex-wrap:wrap;gap:6px" });
  var what = el("input", { id: "bk-what", value: "Service call" });
  var date = el("input", { id: "bk-day", type: "date", value: pre.date || state.date || todayLocal() });
  var time = el("input", { id: "bk-time", type: "time", value: pre.time || "09:00", step: "900" });
  var dur = durationSelect("bk-dur", 120);
  var tech = techSelect("bk-tech", pre.employeeId || null);
  var err = errBox();

  search.oninput = function () {
    found = null;
    var q = this.value;
    if (q.length < 2) { results.innerHTML = ""; return; }
    api("properties?q=" + encodeURIComponent(q)).then(function (list) {
      results.innerHTML = "";
      if (!list.length) results.appendChild(el("span", { class: "sub" }, ["No match."]));
      list.forEach(function (p) {
        var label = p.address + (p.unit ? " unit " + p.unit : "");
        results.appendChild(el("button", { class: "btn small", type: "button", onclick: function () {
          found = p.id; search.value = label; results.innerHTML = ""; err.hidden = true;
        } }, [label]));
      });
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; });
  };

  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Book a job"]),
        pre.propertyId ? (pre.address ? el("p", { class: "sub" }, [pre.address]) : null) : labelled("bk-addr", "Address", el("div", {}, [search, results])),
        labelled("bk-what", "What is wrong", what),
        el("div", { class: "row3" }, [labelled("bk-day", "Day", date), labelled("bk-time", "Start", time), labelled("bk-dur", "How long", dur)]),
        labelled("bk-tech", "Technician", tech),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          if (!found) { err.textContent = "Pick an address from the list first."; err.hidden = false; search.focus(); return; }
          if (!date.value || !time.value) { err.textContent = "Pick a day and a start time."; err.hidden = false; return; }
          var startsAt = localISO(date.value, time.value);
          var body = { propertyId: found, startsAt: startsAt, durationMinutes: Number(dur.value), description: what.value.trim() || "Service call", by: who() };
          if (tech.value) body.employeeId = Number(tech.value);
          runAction(ev.currentTarget, err, "Booking", function () {
            return api("actions/book", { method: "POST", body: body });
          }, function (c) {
            if (state.view === "today" && state.mode === "board") state.date = date.value;
            wrote("Booked " + niceDay(date.value) + " at " + hhmm(startsAt) + (tech.value ? " with " + tech.options[tech.selectedIndex].text : "") + ".", [c]);
          });
        } }, ["Book it"])
      ])
    ])
  ]));
}

/* Edit a job. One dialog for the three ordinary changes: when, how long, who.
   A note rides along. The rare ones (running late, cancel) sit under "···".
   Each change that runs is undoable from the toast. */
function jobDialog(j) {
  var curTech = j.employeeId || (j.technicians && j.technicians.length ? j.technicians[0].id : null) || null;
  var origDay = j.scheduledStart ? dayOf(j.scheduledStart) : (j.day || state.date || todayLocal());
  var origClock = j.scheduledStart ? clockOf(j.scheduledStart) : "09:00";
  var origDur = minutesBetween(j.scheduledStart, j.scheduledEnd) || 120;
  var date = el("input", { id: "ed-day", type: "date", value: origDay });
  var time = el("input", { id: "ed-time", type: "time", value: origClock, step: "900" });
  var dur = durationSelect("ed-dur", origDur);
  var tech = techSelect("ed-tech", curTech);
  var note = el("textarea", { id: "ed-note", rows: "2", placeholder: "Anything the technician should know" });
  var err = errBox();
  var st = statusOf(j);
  var where = (j.address || "no address") + (j.unit ? " #" + j.unit : "");
  var facts = [j.jobRef ? "Job " + j.jobRef : null, j.description || null, st.text, whoBooked(j)].filter(Boolean).join(" · ");

  var menu = el("div", { class: "menu", hidden: true }, [
    el("button", { class: "btn", type: "button", onclick: function () { overlay(null); go("job", j.id); } }, ["Open the job page"]),
    j.isCanceled ? null : el("button", { class: "btn", type: "button", onclick: function () { lateDialog(j); } }, ["Running late"]),
    j.isCanceled ? null : el("button", { class: "btn stop", type: "button", onclick: function () { cancelDialog(j); } }, ["Cancel the visit"])
  ]);
  var more = el("button", { class: "btn quiet", type: "button", "aria-expanded": "false", "aria-label": "More" , onclick: function () {
    menu.hidden = !menu.hidden; more.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
  } }, ["···"]);

  function save(ev) {
    var changes = [], said = [];
    var p = Promise.resolve();
    var newDur = Number(dur.value);
    if (!j.isCanceled && (date.value !== origDay || time.value !== origClock || newDur !== origDur)) {
      var startsAt = localISO(date.value, time.value);
      p = p.then(function () { return api("actions/move", { method: "POST", body: { jobId: j.id, startsAt: startsAt, durationMinutes: newDur, by: who() } }); })
        .then(function (c) { changes.push(c); said.push("moved to " + niceDay(date.value) + " " + hhmm(startsAt)); });
    }
    var newTech = tech.value ? Number(tech.value) : null;
    if (!j.isCanceled && newTech !== curTech) {
      p = p.then(function () { return api("actions/assign", { method: "POST", body: { jobId: j.id, employeeId: newTech, by: who() } }); })
        .then(function (c) { changes.push(c); said.push(newTech ? "now with " + tech.options[tech.selectedIndex].text : "nobody assigned"); });
    }
    var n = note.value.trim();
    if (n) {
      p = p.then(function () { return api("actions/note", { method: "POST", body: { jobId: j.id, note: n, by: who() } }); })
        .then(function (c) { changes.push(c); said.push("note added"); });
    }
    if (p === Promise.resolve() && !said.length && !n && newTech === curTech && date.value === origDay && time.value === origClock && newDur === origDur) { overlay(null); return; }
    runAction(ev.currentTarget, err, "Saving", function () { return p; }, function () {
      if (!said.length) { load(); return; }
      wrote("Saved. " + said.join(", ").replace(/^./, function (ch) { return ch.toUpperCase(); }) + ".", changes);
    });
  }

  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, [(j.customer || "No customer") + " · " + where]),
        el("p", { class: "sub" }, [facts]),
        j.isCanceled ? el("p", { class: "sub" }, ["This visit was canceled."]) : null,
        el("div", { class: "row3" }, [labelled("ed-day", "Day", date), labelled("ed-time", "Start", time), labelled("ed-dur", "How long", dur)]),
        labelled("ed-tech", "Technician", tech),
        labelled("ed-note", "Note", note),
        err
      ]),
      menu,
      el("div", { class: "foot" }, [
        el("div", { class: "l" }, [more]),
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Close"]),
        el("button", { class: "btn key", type: "button", onclick: save }, ["Save"])
      ])
    ])
  ]));
  if (j.isCanceled) { date.disabled = time.disabled = dur.disabled = tech.disabled = true; }
}

function lateDialog(j) {
  var mins = el("input", { id: "lt-min", type: "number", inputmode: "numeric", min: "1", max: "480", value: String(j.lateMinutes || 45), autocomplete: "off" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Running late"]),
        el("p", { class: "sub" }, [(j.customer || "This customer") + ", " + (j.scheduledStart ? hhmm(j.scheduledStart) + " " + daystamp(j.scheduledStart) : "no time set")]),
        labelled("lt-min", "Minutes late", mins),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var m = Number(mins.value);
          if (!m || m < 1) { err.textContent = "Enter how many minutes."; err.hidden = false; mins.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("actions/late", { method: "POST", body: { jobId: j.id, minutes: m, by: who() } });
          }, function (c) { wrote("Marked " + m + " minutes late.", [c]); });
        } }, ["Mark late"])
      ])
    ])
  ]));
}

function noteDialog(j) {
  var note = el("textarea", { id: "nt-body", rows: "3" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Add a note"]),
        labelled("nt-body", "What should the technician know?", note),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var n = note.value.trim();
          if (!n) { err.textContent = "Write the note first."; err.hidden = false; note.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("actions/note", { method: "POST", body: { jobId: j.id, note: n, by: who() } });
          }, function (c) { wrote("Note added.", [c]); });
        } }, ["Add the note"])
      ])
    ])
  ]));
}

/* Cancel is the one destructive action. It asks why, and the button that
   does it is the only red button in the console. */
function cancelDialog(j) {
  var reason = el("textarea", { id: "cx-body", rows: "3" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Cancel this visit?"]),
        el("p", { class: "sub" }, [
          (j.customer || "This customer") + " at " + (j.address || "the address on file") +
          ", " + (j.scheduledStart ? hhmm(j.scheduledStart) + " " + daystamp(j.scheduledStart) : "no time set") + "."
        ]),
        labelled("cx-body", "Why is it being canceled?", reason),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Keep the visit"]),
        el("button", { class: "btn stop", type: "button", onclick: function (ev) {
          var r = reason.value.trim();
          if (!r) { err.textContent = "Say why. It goes on the record."; err.hidden = false; reason.focus(); return; }
          runAction(ev.currentTarget, err, "Canceling", function () {
            return api("actions/cancel", { method: "POST", body: { jobId: j.id, reason: r, by: who() } });
          }, function (c) { wrote("Canceled " + (j.customer || "the visit") + ".", [c]); });
        } }, ["Cancel the visit"])
      ])
    ])
  ]));
}

/* --- agent tickets ------------------------------------------------------ */
/* Two kinds on one list, and the row says which. A PROPOSAL is a row in
   \`ticket\`: nothing has run, and Approve is the decision. ACTIVITY is a
   job_change the agent already filed on a call: it ran, it is undoable for
   an hour, and the call is one click away. */

var openDet = {};
var tkCalls = {};
var KIND_LABEL = { book: "Booked", move: "Moved", cancel: "Canceled", assign: "Assigned", note: "Note added", late: "Marked late", undo: "Undone" };

function loadCall(callId) {
  if (tkCalls[callId]) return;
  tkCalls[callId] = { loading: true };
  api("calls/" + callId).then(function (c) { tkCalls[callId] = c; render(); })
    .catch(function (e) { tkCalls[callId] = { error: e.message || String(e) }; render(); });
}
function ticketKey(t) { return t.type === "proposal" ? "t" + t.id : "c" + t.changeId; }
function ticketSource(t) {
  if (t.type === "proposal") {
    if (t.status !== "open") return t.status.charAt(0).toUpperCase() + t.status.slice(1) + (t.resolvedBy ? " by " + t.resolvedBy : "");
    return t.source === "board" ? "Noticed on the board" : "From a call";
  }
  return t.call ? "Agent, on a call" : "Agent, no call attached";
}
function when(iso) { return dayOf(iso) === todayLocal() ? hhmm(iso) : daystamp(iso) + " " + hhmm(iso); }

/* One ticket, one line until selected. The dot is orange when it waits on a
   person, the hatch tone when it is a late mark, and grey otherwise. The
   meta line only carries a fact the headline does not already say. */
function ticketRow(t) {
  var key = ticketKey(t);
  var on = state.sel === key;
  var isProp = t.type === "proposal";
  var openProp = isProp && t.status === "open";
  var head = isProp ? t.goal : (t.summary || KIND_LABEL[t.kind] || t.kind);
  var tone = openProp ? " need" : (!isProp && t.kind === "late" ? " late" : "");
  var meta = [];
  if (isProp) {
    var u = openProp ? urgencyOf(t.dueAt) : null;
    if (u) meta.push(el("span", { class: u.cls === "late" ? "late" : "" }, ["due " + u.text]));
    if (t.risks && t.risks.length) meta.push(el("span", {}, [t.risks.length + (t.risks.length === 1 ? " risk" : " risks")]));
    if (t.gaps && t.gaps.length) meta.push(el("span", {}, ["needs checking"]));
  } else {
    if (t.customer && head.indexOf(t.customer) < 0) meta.push(el("span", {}, [t.customer]));
    if (t.address && head.indexOf(t.address) < 0) meta.push(el("span", {}, [t.address + (t.unit ? " #" + t.unit : "")]));
  }
  if (t.jobRef && head.indexOf(t.jobRef) < 0) meta.push(el("span", { class: "q mono" }, ["Job " + t.jobRef]));

  var row = el("div", { class: "qrow" + (on ? " on" : ""), id: isProp ? "ticket-" + t.id : "change-" + t.changeId });
  var text = on
    ? el("span", { style: "flex:1;min-width:0" }, [el("div", { class: "head" }, [head]), meta.length ? el("div", { class: "meta" }, meta) : null])
    : el("span", { class: "line" }, [el("span", { class: "head" }, [head]), meta.length ? el("span", { class: "meta" }, meta) : null]);
  row.appendChild(el("button", { class: "top", type: "button", "aria-expanded": on ? "true" : "false",
    onclick: function () { state.sel = on ? null : key; state.menu = null; render(); } }, [
    el("span", { class: "dot7" + tone, "aria-hidden": "true" }),
    text,
    el("span", { class: "tm" }, [when(t.createdAt)])
  ]));
  if (on) row.appendChild(ticketBody(t, key));
  return row;
}

function ticketBody(t, key) {
  var isProp = t.type === "proposal";
  var openProp = isProp && t.status === "open";
  var body = el("div", { class: "body" });
  if (isProp) {
    if (t.why) body.appendChild(el("div", { class: "why" }, [t.why]));
  } else {
    var line = [];
    if (t.call) line.push((t.call.channel === "web" ? "Test line" : "Phone") + " call at " + hhmm(t.call.startedAt) + ", " + t.call.turnCount + " turns, " + t.call.toolCount + " lookups");
    if (t.call && t.call.handoffReason) line.push("Handed off: " + t.call.handoffReason.replace(/_/g, " "));
    line.push(t.undoable ? "Undo open until " + hhmm(t.undoWindowEndsAt) : "Undo closed");
    body.appendChild(el("div", { class: "why" }, [line.join(". ") + "."]));
  }

  var acts = el("div", { class: "acts" });
  var menuItems = [];
  if (openProp) {
    acts.appendChild(el("button", { class: "btn key", type: "button", onclick: function () { approveDialog(t); } }, ["Approve"]));
    acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { counterDialog(t); } }, ["Change"]));
    menuItems.push(["I'll do this myself", function () { dismissTicketDialog(t, "Doing this myself"); }]);
    menuItems.push(["Dismiss", function () { dismissTicketDialog(t, ""); }]);
  } else if (!isProp && t.undoable) {
    acts.appendChild(el("button", { class: "btn key", type: "button", onclick: function (ev) { undoActivity(t, ev.currentTarget); } }, ["Undo"]));
    if (t.jobId) acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { go("job", t.jobId); } }, ["Open the job"]));
  } else {
    if (t.jobId) acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { go("job", t.jobId); } }, ["Open the job"]));
    acts.appendChild(el("button", { class: "btn", type: "button", "aria-expanded": openDet[key] ? "true" : "false", onclick: function () { toggleDet(t, key); } }, [openDet[key] ? "Hide details" : "Details"]));
  }
  /* A callback is the one ticket whose whole job is "ring this person about
     what they already told us", so reading the call is the first action, not
     something behind a menu. */
  if (t.kind === "callback" && t.callId) {
    acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { go("calls", t.callId); } }, ["Read the call"]));
  }
  if (openProp || (!isProp && t.undoable)) {
    menuItems.push([openDet[key] ? "Hide details" : "Details", function () { toggleDet(t, key); }]);
    if (t.jobId && openProp) menuItems.push(["Open the job", function () { go("job", t.jobId); }]);
  }
  /* Any ticket that came from a call can open that call. A handoff now files a
     proposal — "call this person back" — and the first thing whoever picks it up
     needs is what was already said, so they do not make the caller repeat it.
     The condition used to exclude proposals, which is exactly the kind that
     most needs the transcript. */
  if (t.callId) menuItems.push(["Read the call", function () { go("calls", t.callId); }]);
  menuItems.push(["Export", function () { exportTicket(t); }]);
  var menuOpen = state.menu === key;
  acts.appendChild(el("button", { class: "btn quiet", type: "button", "aria-label": "More", "aria-expanded": menuOpen ? "true" : "false",
    onclick: function () { state.menu = menuOpen ? null : key; render(); } }, ["···"]));
  acts.appendChild(el("span", { class: "src" }, [ticketSource(t)]));
  body.appendChild(acts);
  if (menuOpen) {
    body.appendChild(el("div", { class: "menu" }, menuItems.map(function (m) {
      return el("button", { class: "btn", type: "button", onclick: function () { state.menu = null; m[1](); } }, [m[0]]);
    })));
  }
  if (openDet[key]) body.appendChild(ticketDetail(t));
  return body;
}
function toggleDet(t, key) {
  openDet[key] = !openDet[key];
  if (openDet[key] && t.type === "activity" && t.callId) loadCall(t.callId);
  state.menu = null;
  render();
}

/* The literal call that will run: name and arguments, byte for byte what
   the server executes on approval. Not a paraphrase. */
function toolLine(step) {
  return el("code", { class: "tc" }, [el("i", {}, [step.tool]), "(" + JSON.stringify(step.args || {}) + ")"]);
}
function factRows(facts) {
  var box = el("div", {});
  (facts || []).forEach(function (f) {
    box.appendChild(el("div", { class: "fact" }, [
      el("span", { class: "k" }, [f.label]),
      el("span", {}, [f.value, f.source ? el("span", { class: "src" }, [f.source]) : null])
    ]));
  });
  return box;
}
function fmtVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(v)) return daystamp(v) + " " + hhmm(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ticketDetail(t) {
  var det = el("div", { class: "det" });
  if (t.type === "proposal") {
    det.appendChild(el("div", { class: "lab" }, ["Steps, in order"]));
    var ol = el("ol", { class: "steps" });
    t.steps.forEach(function (s) { ol.appendChild(el("li", {}, [toolLine(s), s.description])); });
    det.appendChild(ol);
    if (t.facts.length) { det.appendChild(el("div", { class: "lab" }, ["Facts, from the record"])); det.appendChild(factRows(t.facts)); }
    if (t.risks.length) { det.appendChild(el("div", { class: "lab" }, ["Risks"])); det.appendChild(el("ul", { class: "rk" }, t.risks.map(function (r) { return el("li", {}, [r]); }))); }
    if (t.gaps.length) { det.appendChild(el("div", { class: "lab" }, ["What it did not know"])); det.appendChild(el("ul", { class: "gp" }, t.gaps.map(function (g) { return el("li", {}, [g]); }))); }
    det.appendChild(el("div", { class: "lab" }, ["Closes when"]));
    det.appendChild(el("div", { class: "close" }, [t.closeCondition]));
    if (t.status === "open") {
      det.appendChild(el("div", { class: "close sub" }, ["Nothing has run yet. Approving runs these steps as " + who() + ". Undo stays open for an hour."]));
    } else {
      det.appendChild(el("div", { class: "lab" }, ["Decision"]));
      det.appendChild(el("div", { class: "close" }, [
        t.status.charAt(0).toUpperCase() + t.status.slice(1) + " by " + (t.resolvedBy || "office") +
        (t.resolvedAt ? ", " + daystamp(t.resolvedAt) + " " + hhmm(t.resolvedAt) : "") +
        (t.resolutionNote ? ". “" + t.resolutionNote + "”" : "")
      ]));
      var ran = (t.result && t.result.ran) || [];
      if (ran.length) {
        var ul = el("ul", {});
        ran.forEach(function (r) { ul.appendChild(el("li", {}, [r.tool + ": " + (r.summary || "") + (r.changeId > 0 ? " (change #" + r.changeId + ")" : "")])); });
        det.appendChild(ul);
      }
    }
  } else {
    var keys = {};
    Object.keys(t.before || {}).concat(Object.keys(t.after || {})).forEach(function (k) { keys[k] = 1; });
    var diff = el("div", { class: "diff" });
    Object.keys(keys).forEach(function (k) {
      var b = (t.before || {})[k], a = (t.after || {})[k];
      if (JSON.stringify(b) === JSON.stringify(a)) return;
      diff.appendChild(el("span", { class: "k" }, [k]));
      diff.appendChild(el("span", {}, [fmtVal(b) + " → " + fmtVal(a)]));
    });
    if (diff.childNodes.length) { det.appendChild(el("div", { class: "lab" }, ["What changed on the job"])); det.appendChild(diff); }
    det.appendChild(el("div", { class: "lab" }, ["Filed by"]));
    det.appendChild(el("div", { class: "close" }, [(t.actorLabel || "the agent") + ", change #" + t.changeId + (t.callId ? ", on call #" + t.callId : "")]));
    if (t.callId) {
      det.appendChild(el("div", { class: "lab" }, ["What happened on the call"]));
      var c = tkCalls[t.callId];
      if (!c || c.loading) det.appendChild(el("div", { class: "skel", style: "padding:6px 0" }, ["Reading the call"]));
      else if (c.error) det.appendChild(el("div", { class: "err", role: "alert" }, [c.error]));
      else {
        var trace = el("div", { class: "trace" });
        c.events.forEach(function (e) { trace.appendChild(traceStep(e)); });
        det.appendChild(trace);
      }
    }
  }
  return det;
}

/* Approval is a second read of the same plan, with the risks beside the
   button that runs it. The office person, not the agent, is the actor. */
function approveDialog(t) {
  var err = errBox();
  var ol = el("ol", { class: "steps" });
  t.steps.forEach(function (s) { ol.appendChild(el("li", {}, [toolLine(s), s.description])); });
  overlay(veil([
    el("div", { class: "modal wide" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Approve ticket #" + t.id + "?"]),
        el("p", { class: "sub" }, [t.goal]),
        el("span", { class: "lab" }, ["This will run as " + who()]),
        ol,
        t.risks.length ? el("span", { class: "lab" }, ["Risks"]) : null,
        t.risks.length ? el("ul", { class: "rk" }, t.risks.map(function (r) { return el("li", {}, [r]); })) : null,
        t.gaps.length ? el("span", { class: "lab" }, ["Not known"]) : null,
        t.gaps.length ? el("ul", { class: "gp" }, t.gaps.map(function (g) { return el("li", {}, [g]); })) : null,
        el("span", { class: "lab" }, ["Closes when"]),
        el("div", { class: "close" }, [t.closeCondition]),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Not yet"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          runAction(ev.currentTarget, err, "Running", function () {
            return api("tickets/" + t.id + "/approve", { method: "POST", body: { by: who() } });
          }, function (r) {
            var ran = (r.result && r.result.ran) || [];
            var ids = ran.map(function (x) { return x.changeId; }).filter(function (id) { return id > 0; });
            toast("Ticket #" + t.id + " approved. " + (ran.map(function (x) { return x.summary; }).join(". ") || "Done") + ".", ids);
            state.sel = null; load();
          });
        } }, ["Approve"])
      ])
    ])
  ]));
}

/* "Change": the person says what happens instead, in their words. Nothing
   runs from here; the change itself is made on the board or the job page. */
function counterDialog(t) {
  var note = el("textarea", { id: "ct-body", rows: "3", placeholder: "Put Tanya on it instead, and I will call the customer" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Change ticket #" + t.id]),
        el("p", { class: "sub" }, [t.goal + ". The ticket closes and nothing runs. Make the change on the board."]),
        labelled("ct-body", "What happens instead", note),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var n = note.value.trim();
          if (!n) { err.textContent = "Say what you will do instead."; err.hidden = false; note.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("tickets/" + t.id + "/counter", { method: "POST", body: { by: who(), note: n } });
          }, function () { toast("Ticket #" + t.id + " closed. Your note is on the record."); state.sel = null; load(); });
        } }, ["Save"])
      ])
    ])
  ]));
}

function dismissTicketDialog(t, preset) {
  var note = el("textarea", { id: "dt-body", rows: "3", placeholder: "Why?" });
  if (preset) note.value = preset;
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, [preset ? "Take ticket #" + t.id + " yourself?" : "Dismiss ticket #" + t.id + "?"]),
        el("p", { class: "sub" }, [t.goal + ". The agent drops it and will not raise it again for this job."]),
        labelled("dt-body", "Why?", note),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Keep it"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var n = note.value.trim();
          if (!n) { err.textContent = "Give a reason. It goes on the record."; err.hidden = false; note.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("tickets/" + t.id + "/dismiss", { method: "POST", body: { by: who(), reason: n } });
          }, function () { toast("Ticket #" + t.id + " dismissed."); state.sel = null; load(); });
        } }, [preset ? "It's mine" : "Dismiss"])
      ])
    ])
  ]));
}

function undoActivity(t, btn) {
  btn.disabled = true; btn.textContent = "Undoing";
  api("actions/undo", { method: "POST", body: { changeId: t.changeId, by: who() } })
    .then(function () { toast("Undone: " + (t.summary || t.kind) + "."); state.sel = null; load(); })
    .catch(function (e) { btn.disabled = false; btn.textContent = "Undo"; toast("Could not undo. " + e.message); });
}

/* The whole thing as a file: the ticket or change, and the call it rests on. */
function exportTicket(t) {
  var name = t.type === "proposal" ? "ticket-" + t.id : "agent-change-" + t.changeId;
  function finish(call) {
    var out = { exportedAt: new Date().toISOString(), exportedBy: who(), type: t.type, item: t, call: call || null };
    download(name + "-" + stamp() + ".json", JSON.stringify(out, null, 2));
    toast("Saved " + name + " as a file.");
  }
  var c = t.callId ? tkCalls[t.callId] : null;
  if (t.callId && (!c || c.loading || c.error)) {
    api("calls/" + t.callId).then(function (call) { tkCalls[t.callId] = call; finish(call); }).catch(function () { finish(null); });
  } else finish(c);
}

/* The Tickets screen: three tabs over one list. */
/* How long somebody has been waiting, in the words a person would use. */
function waitedFor(iso) {
  if (!iso) return "";
  var mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min";
  var h = Math.round(mins / 60);
  if (h < 24) return h + (h === 1 ? " hour" : " hours");
  var days = Math.round(h / 24);
  return days + (days === 1 ? " day" : " days");
}

/* Safety first, then whoever has been waiting longest. Somebody who reported a
   gas smell does not go behind a quote request because the quote came in first. */
var CALLBACK_ORDER = { safety: 0, repeat_visit_or_upset_caller: 1, access_code_unverified_caller: 2 };
function callbackRank(t) {
  var why = String(t.why || "").toLowerCase();
  for (var k in CALLBACK_ORDER) {
    if (Object.prototype.hasOwnProperty.call(CALLBACK_ORDER, k) &&
        why.indexOf(k.replace(/_/g, " ")) >= 0) return CALLBACK_ORDER[k];
  }
  return 5;
}

function viewTickets() {
  if (!state.allTickets) return el("div", { class: "skel" }, ["Reading the tickets"]);
  var items = state.allTickets;

  /* FOUR COLUMNS, NOT ONE LIST.
     A list of two dozen tickets sorted by time is a pile. These are four
     different jobs — ring somebody, decide something, check what ran, look
     something up — and a person does one of them at a time. Columns let you see
     how much of each there is without scrolling, which is the question you
     actually have when you sit down. */
  var callbacks = items.filter(function (t) { return t.type === "proposal" && t.status === "open" && t.kind === "callback"; });
  var todo      = items.filter(function (t) { return t.type === "proposal" && t.status === "open" && t.kind !== "callback"; });
  /* Work the agent did FOR A CUSTOMER. The scripted demo and the write-path
     suite drive the same real write path, so their changes land here too — 38
     of 40 cards on this board were things nobody had to look at. Hidden by
     default, one click away, never deleted. */
  var allDone   = items.filter(function (t) { return t.type === "activity"; });
  var rehearsed = allDone.filter(function (t) { return t.rehearsal; });
  var done      = state.showDemoWork ? allDone : allDone.filter(function (t) { return !t.rehearsal; });
  var decided   = items.filter(function (t) { return t.type === "proposal" && t.status !== "open"; });

  callbacks.sort(function (a, b) {
    var r = callbackRank(a) - callbackRank(b);
    return r !== 0 ? r : new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
  todo.sort(function (a, b) { return new Date(a.dueAt || a.createdAt || 0) - new Date(b.dueAt || b.createdAt || 0); });

  /* One card. Short enough that a column of them can be read at a glance, and
     every one opens the same case card — nothing is decided from the front. */
  function card(t, opts) {
    opts = opts || {};
    var head = t.type === "proposal" ? t.goal : (t.summary || KIND_LABEL[t.kind] || t.kind);
    var meta = [];
    if (opts.waiting && t.createdAt) meta.push("waiting " + waitedFor(t.createdAt));
    if (t.dueAt && t.status === "open") meta.push(dueIn(t.dueAt));
    if (t.address) meta.push(t.address);
    if (t.jobRef) meta.push("job " + t.jobRef);
    if (!opts.waiting && !t.dueAt && t.createdAt) meta.push(hhmm(t.createdAt));
    var urgent = opts.waiting && callbackRank(t) === 0;
    return el("button", {
      class: "tcard" + (urgent ? " urgent" : "") + (t.type === "activity" ? " quiet" : ""),
      type: "button",
      onclick: function () { ticketCase(t); }
    }, [
      urgent ? el("span", { class: "flag" }, ["safety"]) : null,
      el("span", { class: "h" }, [head]),
      meta.length ? el("span", { class: "m" }, [meta.join(" · ")]) : null
    ].filter(Boolean));
  }

  function column(title, list, empty, opts) {
    var body = el("div", { class: "col-b" });
    if (!list.length) body.appendChild(el("div", { class: "empty" }, [empty]));
    list.forEach(function (t) { body.appendChild(card(t, opts)); });
    return el("section", { class: "col", "aria-label": title }, [
      el("div", { class: "col-h" }, [el("h2", {}, [title]), el("span", { class: "n" }, [String(list.length)])]),
      body
    ]);
  }

  return el("div", { class: "kanban" }, [
    column("Call backs", callbacks, "Nobody is waiting for a call.", { waiting: true }),
    column("Needs a decision", todo, "Nothing to decide.", {}),
    (function () {
      var col = column("The agent did", done, "Nothing for a customer lately.", {});
      if (rehearsed.length) {
        col.appendChild(el("button", { class: "more", type: "button",
          onclick: function () { state.showDemoWork = !state.showDemoWork; render(); } },
          [state.showDemoWork
            ? "Hide the " + rehearsed.length + " from rehearsals"
            : "Show " + rehearsed.length + " from rehearsals"]));
      }
      return col;
    })(),
    column("Closed", decided, "Nothing closed yet.", {})
  ]);
}

/* When it is due, in the words a person would use. */
function dueIn(iso) {
  var m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m < 0) return "overdue";
  if (m < 60) return "due in " + m + " min";
  var h = Math.round(m / 60);
  return "due in " + h + (h === 1 ? " hour" : " hours");
}

/* THE CASE, IN A PARAGRAPH.
   What it is, where it came from, why, and what happens if you say yes — then
   the buttons. Everything longer lives on the call or the job, one click away. */
function ticketCase(t) {
  var isProp = t.type === "proposal";
  var head = isProp ? t.goal : (t.summary || KIND_LABEL[t.kind] || t.kind);

  var rows = [];
  function row(k, v) { if (v) rows.push(el("div", { class: "kv2" }, [el("span", { class: "k" }, [k]), el("span", { class: "v" }, [v])])); }

  row("Where it came from", t.source === "call" || t.callId
    ? ("a call" + (t.address ? " about " + t.address : "")) 
    : "the agent reading the board");
  row("Why", t.why || null);
  if (isProp && t.status === "open") {
    row("What happens if you approve", (t.steps && t.steps.length)
      ? t.steps.map(function (s) { return s.tool ? String(s.tool).replace(/_/g, " ") : String(s.why || ""); }).join(", ")
      : null);
    row("It is finished when", t.closeCondition || null);
  }
  if (!isProp) row("Already done", (t.actorLabel || "the agent") + (t.callId ? ", on a call" : "") + (t.undoable ? " — can still be undone" : " — past the undo window"));
  if (t.risks && t.risks.length) row("Watch out for", t.risks.join(". "));
  if (t.gaps && t.gaps.length) row("Not known", t.gaps.join(". "));

  var facts = el("div", {});
  (t.facts || []).forEach(function (f) {
    facts.appendChild(el("div", { class: "kv2" }, [
      el("span", { class: "k" }, [f.label || "Fact"]), el("span", { class: "v" }, [String(f.value)])
    ]));
  });

  var acts = el("div", { class: "foot" });
  if (isProp && t.status === "open" && t.kind !== "callback") {
    acts.appendChild(el("button", { class: "btn key", type: "button", onclick: function () { overlay(null); approveDialog(t); } }, ["Approve"]));
    acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { overlay(null); counterDialog(t); } }, ["Change it"]));
    acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { overlay(null); dismissTicketDialog(t, ""); } }, ["Dismiss"]));
  }
  if (t.callId) acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { overlay(null); go("calls", t.callId); } }, ["Read the call"]));
  if (t.jobId) acts.appendChild(el("button", { class: "btn", type: "button", onclick: function () { overlay(null); go("job", t.jobId); } }, ["Open the job"]));
  if (!isProp && t.undoable) acts.appendChild(el("button", { class: "btn", type: "button", onclick: function (ev) { undoActivity(t, ev.currentTarget); overlay(null); } }, ["Undo"]));
  acts.appendChild(el("button", { class: "btn quiet", type: "button", style: "margin-left:auto", onclick: function () { overlay(null); } }, ["Close"]));

  overlay(veil([el("div", { class: "modal" }, [
    el("div", { class: "hd" }, [el("div", {}, [
      el("h3", {}, [head]),
      el("div", { class: "meta" }, [
        el("span", {}, [t.createdAt ? daystamp(t.createdAt) + " " + hhmm(t.createdAt) : ""]),
        t.risk ? el("span", {}, [t.risk === "high" ? "needs a person" : "the agent may run this itself"]) : null
      ].filter(Boolean))
    ])]),
    el("div", { class: "body" }, rows.concat([facts])),
    acts
  ])]));
}

/* --- next up: the full list, and what was done about it --------------- */

/* One line per item and one button. Case file for a call, Done for a
   follow-up, Open ticket for a ticket. */
function pressingRow(p) {
  var act;
  if (p.kind === "live" || p.kind === "callback") act = el("button", { class: "btn small" + (p.kind === "live" ? " key" : ""), type: "button", onclick: function () { caseFile(p); } }, ["Case file"]);
  else if (p.kind === "due") act = el("button", { class: "btn small", type: "button", onclick: function () { pressingDoneDialog(p); } }, ["Done"]);
  else act = el("button", { class: "btn small", type: "button", onclick: function () { openPressing(p); } }, ["Open ticket"]);
  var whenText = p.kind === "live" || !p.at ? "" : when(p.at);
  var metaText = [p.kind === "due" || p.kind === "ticket" ? p.detail : null, p.summary ? trunc(p.summary, 140) : null].filter(Boolean).join(" · ");
  return el("div", { class: "qrow", style: "display:flex;align-items:center;gap:11px" }, [
    p.kind === "live" ? el("span", { class: "dot", "aria-hidden": "true" }) : el("span", { class: "dot7" + (p.urgency === "now" ? " late" : " need"), style: "margin-top:0", "aria-hidden": "true" }),
    el("span", { style: "flex:1;min-width:0" }, [
      el("div", { class: "head", style: "font-size:13px" }, [p.title + (p.reasonLabel ? " · " + p.reasonLabel : "") + (p.kind === "live" ? " · " : "")].concat(p.kind === "live" ? [el("span", { class: "livechip" }, ["live"])] : [])),
      metaText ? el("div", { class: "meta" }, [el("span", {}, [metaText])]) : null
    ]),
    whenText ? el("span", { class: "tm" }, [whenText]) : null,
    act
  ]);
}

function viewPressing() {
  if (!state.pressing) return el("div", { class: "skel" }, ["Reading"]);
  var rehearsals = state.pressing.filter(function (p) { return p.rehearsal; });
  var shown = visiblePressing();
  var menuOpen = state.menu === "pressing";
  var card = el("div", { class: "card" }, [
    el("div", { class: "card-h" }, [
      el("h2", {}, ["Next up"]),
      el("span", { class: "n" }, [String(shown.length)]),
      rehearsals.length ? el("span", { class: "r" }, [
        el("button", { class: "btn quiet small", type: "button", "aria-label": "More", "aria-expanded": menuOpen ? "true" : "false",
          onclick: function () { state.menu = menuOpen ? null : "pressing"; render(); } }, ["···"])
      ]) : null
    ])
  ]);
  if (menuOpen && rehearsals.length) {
    card.appendChild(el("div", { class: "menu", style: "padding:10px 18px;border-bottom:1px solid var(--line-row)" }, [
      el("button", { class: "btn", type: "button", onclick: function () { state.showRehearsals = !state.showRehearsals; state.menu = null; render(); } },
        [state.showRehearsals ? "Hide demo calls" : "Show " + rehearsals.length + " demo " + (rehearsals.length === 1 ? "call" : "calls")]),
      el("button", { class: "btn", type: "button", onclick: function () { state.menu = null; clearRehearsalsDialog(rehearsals); } }, ["Clear demo calls"])
    ]));
  }
  if (!shown.length) card.appendChild(el("div", { class: "empty" }, ["Nothing waiting on a person."]));
  shown.forEach(function (p) { card.appendChild(pressingRow(p)); });
  return card;
}

/* "Done" is a row with a reason, not a checkbox: what the office did about a
   handoff is part of the call's record. */
function pressingDoneDialog(p) {
  var note = el("textarea", { id: "pd-body", rows: "3", placeholder: "Called back, left a message, booked it" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["What was done?"]),
        el("p", { class: "sub" }, [p.title + (p.reasonLabel ? " · " + p.reasonLabel : "")]),
        labelled("pd-body", "What you did", note),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Cancel"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var r = note.value.trim();
          if (!r) { err.textContent = "Say what was done."; err.hidden = false; note.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("queues/" + p.dismiss.queue + "/dismiss", { method: "POST", body: {
              subjectType: p.dismiss.subjectType, subjectId: p.dismiss.subjectId, reason: who() + ": " + r
            } });
          }, function () { toast("Marked done."); load(); });
        } }, ["Mark done"])
      ])
    ])
  ]));
}

function clearRehearsalsDialog(rehearsals) {
  var err = errBox();
  var ids = rehearsals.filter(function (p) { return p.dismiss; }).map(function (p) { return p.dismiss.subjectId; });
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Clear " + ids.length + " demo " + (ids.length === 1 ? "call" : "calls") + "?"]),
        el("p", { class: "sub" }, ["These came from the scripted demo, not from customers. Each is marked done with the reason “demo rehearsal”. The calls stay in Calls."]),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Keep them"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          runAction(ev.currentTarget, err, "Clearing", function () {
            return api("queues/handoff_followup/dismiss", { method: "POST", body: {
              subjectType: "call", subjectIds: ids, reason: who() + ": demo rehearsal, cleared from the desk"
            } });
          }, function (r) { toast((r.dismissed || ids.length) + " demo calls cleared."); load(); });
        } }, ["Clear them"])
      ])
    ])
  ]));
}

/* --- the escalation, wherever the person is ------------------------------ */
/* Polled with everything else, never a second channel. A live call that has
   handed off is the one event worth interrupting for, so it appears as a
   corner card rather than a modal: the board underneath must stay usable. */

var seenEsc = {};
try { seenEsc = JSON.parse(sessionStorage.getItem("fd_seen_esc") || "{}"); } catch (e) { seenEsc = {}; }
function markSeen(callId) {
  seenEsc[callId] = 1;
  try { sessionStorage.setItem("fd_seen_esc", JSON.stringify(seenEsc)); } catch (e) { /* private mode */ }
}

function watchEscalations() {
  var all = state.pressing || [];
  var current = state.popup && all.filter(function (p) { return p.callId === state.popup.callId; })[0];
  if (state.popup && !current) state.popup = null;
  else if (current) state.popup = current;
  if (!state.popup) {
    state.popup = all.filter(function (p) { return p.kind === "live" && p.reason && !p.rehearsal && !seenEsc[p.callId]; })[0] || null;
  }
  renderPop();
}

function renderPop() {
  var host = document.getElementById("pop");
  host.innerHTML = "";
  var p = state.popup;
  if (!p) return;
  var live = p.kind === "live";
  host.appendChild(el("div", { class: "pop", role: "status", "aria-live": "polite" }, [
    el("span", { class: "livechip" }, [live ? el("span", { class: "dot", "aria-hidden": "true" }) : null, live ? "live" : "Needs a callback"]),
    el("div", { class: "ti" }, [p.title]),
    el("div", { class: "su" }, [
      (p.reasonLabel ? p.reasonLabel + ". " : "") +
      (p.summary ? trunc(p.summary, 150) : "The agent stopped and asked for a person.") +
      (live ? " Can you take it?" : "")
    ]),
    el("div", { class: "a" }, [
      el("button", { class: "btn small key", type: "button", onclick: function () { caseFile(p); } }, ["Open case file"]),
      el("button", { class: "btn small", type: "button", onclick: function () { markSeen(p.callId); state.popup = null; renderPop(); } }, ["Not now"])
    ])
  ]));
}

/**
 * The case file, in five slots: who and where, why it stopped, what the agent
 * already did, where it left off, and what to do next. Every slot is read
 * from the call's own record and the property record.
 */
function caseFile(p) {
  var shell = el("div", { class: "modal wide case" }, [el("div", { class: "body" }, [el("div", { class: "skel" }, ["Opening the case file"])])]);
  overlay(el("div", { class: "veil", onclick: function (e) { if (e.target === this) { traceRepaint = null; overlay(null); } } }, [shell]));

  Promise.all([
    api("calls/" + p.callId),
    p.propertyId ? api("property/" + p.propertyId).catch(function () { return null; }) : Promise.resolve(null)
  ]).then(function (r) {
    var c = r[0], d = r[1];
    if (!document.getElementById("overlay").contains(shell)) return;
    shell.innerHTML = "";

    var turns = c.events.filter(function (e) { return e.kind === "turn"; });
    var lastCaller = turns.filter(function (e) { return e.role === "caller"; }).slice(-1)[0];
    var lastAgent = turns.filter(function (e) { return e.role === "agent"; }).slice(-1)[0];
    var tools = [];
    c.events.forEach(function (e) { if (e.kind === "tool" && tools.indexOf(e.toolName) < 0) tools.push(e.toolName); });
    var refusals = c.events.filter(function (e) { return e.kind === "refusal"; }).length;
    var proofs = c.events.filter(function (e) { return e.kind === "proof"; }).length;
    var handoffEv = c.events.filter(function (e) { return e.kind === "handoff"; })[0];
    var live = c.status === "live";

    var head = el("div", { class: "hd" }, [
      el("div", {}, [
        el("h3", {}, [c.address || c.callerLabel || c.fromNumber || "Unknown caller"]),
        el("div", { class: "meta" }, [
          el("span", {}, [(c.channel === "web" ? "Test line" : "Phone") + ", " + daystamp(c.startedAt) + " " + hhmm(c.startedAt)]),
          el("span", {}, [c.turnCount + " turns, " + c.toolCount + " lookups"]),
          el("span", {}, [live ? spanText((Date.now() - new Date(c.startedAt)) / 60000) + " on the line" : "ended"])
        ])
      ]),
      live ? el("span", { class: "livechip", style: "margin-left:auto" }, [el("span", { class: "dot", "aria-hidden": "true" }), "live"]) : null
    ]);

    var whoWhere = el("ul", {});
    whoWhere.appendChild(el("li", {}, ["Caller: " + (c.callerLabel || c.fromNumber || "no name or number on the call")]));
    if (d) {
      whoWhere.appendChild(el("li", {}, [
        "Property: " + d.property.street + (d.property.unit ? " unit " + d.property.unit : "") +
        (d.property.city ? ", " + d.property.city : "") + " · " + d.property.visitCount + " visits" +
        (d.property.lastVisitAt ? ", last " + daystamp(d.property.lastVisitAt) : "")
      ]));
      whoWhere.appendChild(el("li", {}, ["Money owed: " + money(d.balance.openCents) + " on " + d.balance.openInvoices + (d.balance.openInvoices === 1 ? " invoice" : " invoices")]));
      var access = (d.facts && d.facts.access) || [];
      access.slice(0, 3).forEach(function (f) {
        var val = Object.keys(f.payload).filter(function (k) {
          return f.payload[k] && k.charAt(0) !== "_" && !/(^|_)id$|value_known/.test(k);
        }).map(function (k) {
          var v = f.payload[k];
          return k.replace(/_/g, " ") + ": " + (typeof v === "string" ? v : JSON.stringify(v));
        }).join(" · ");
        if (val) whoWhere.appendChild(el("li", {}, ["Access on file" + (f.jobRef ? " (job " + f.jobRef + ")" : "") + ": " + val]));
      });
    } else {
      whoWhere.appendChild(el("li", {}, ["Property: not matched on this call"]));
    }

    var did = el("ul", {});
    if (tools.length) did.appendChild(el("li", {}, ["Looked up: " + tools.map(function (t) { return DOING[t] ? DOING[t].toLowerCase() : t; }).join(", ")]));
    if (proofs) did.appendChild(el("li", {}, [proofs + (proofs === 1 ? " fact" : " facts") + " backed by a note on file"]));
    if (refusals) did.appendChild(el("li", {}, [refusals + (refusals === 1 ? " thing" : " things") + " it would not do"]));
    (c.changes || []).forEach(function (ch) {
      did.appendChild(el("li", {}, [(ch.undoneAt ? "Undone: " : "Changed: ") + (ch.jobRef ? "job " + ch.jobRef + ", " : "") + (ch.summary || ch.kind)]));
    });
    if (!did.childNodes.length) did.appendChild(el("li", {}, ["Nothing was looked up or changed."]));

    var slots = el("div", {}, [
      el("div", { class: "slot hot" }, [
        el("div", { class: "n" }, ["Why it stopped"]),
        el("div", { class: "tldr" }, [
          (p.reasonLabel || (handoffEv && handoffEv.body) || "Handed off") + ". " +
          (p.summary || (handoffEv && handoffEv.meta && handoffEv.meta.automatic ? "The safety check stopped it." : "The agent asked for a person."))
        ])
      ]),
      el("div", { class: "slot" }, [el("div", { class: "n" }, ["Who and where"]), whoWhere]),
      el("div", { class: "slot" }, [el("div", { class: "n" }, ["What the agent already did"]), did]),
      el("div", { class: "slot" }, [
        el("div", { class: "n" }, ["Where it left off"]),
        lastCaller ? el("div", { class: "said" }, [el("b", {}, ["Caller: "]), "“" + trunc(lastCaller.body, 260) + "”"]) : null,
        lastAgent ? el("div", { class: "said", style: "margin-top:4px" }, [el("b", {}, ["Agent: "]), "“" + trunc(lastAgent.body, 260) + "”"]) : null
      ]),
      el("div", { class: "slot" }, [
        el("div", { class: "n" }, ["What to do next"]),
        el("div", { class: "said" }, [p.next || "Read the call."])
      ])
    ]);

    var trailOpen = false;
    var trailHost = el("div", { class: "slot" });
    function paintTrail() {
      trailHost.innerHTML = "";
      trailHost.appendChild(el("button", { class: "btn small", type: "button", "aria-expanded": trailOpen ? "true" : "false",
        onclick: function () { trailOpen = !trailOpen; paintTrail(); } },
        [trailOpen ? "Hide the call" : "Show the whole call, " + c.events.length + " steps"]));
      if (trailOpen) {
        var trace = el("div", { class: "trace" });
        c.events.forEach(function (e) { trace.appendChild(traceStep(e)); });
        trailHost.appendChild(trace);
      }
    }
    traceRepaint = paintTrail;
    paintTrail();

    var err = errBox();
    var foot = el("div", { class: "foot" }, [
      el("div", { class: "l" }, [
        el("button", { class: "btn", type: "button", onclick: function () { traceRepaint = null; overlay(null); go("calls", c.id); } }, ["Open the call"])
      ]),
      el("button", { class: "btn", type: "button", onclick: function () { traceRepaint = null; markSeen(p.callId); state.popup = null; renderPop(); overlay(null); } }, ["Not now"]),
      p.dismiss ? el("button", { class: "btn key", type: "button", onclick: function (ev) {
        runAction(ev.currentTarget, err, "Saving", function () {
          return api("queues/" + p.dismiss.queue + "/dismiss", { method: "POST", body: {
            subjectType: p.dismiss.subjectType, subjectId: p.dismiss.subjectId,
            reason: who() + ": " + (live ? "taking the call" : "taking this callback")
          } });
        }, function () {
          traceRepaint = null; markSeen(p.callId); state.popup = null; renderPop();
          toast(live ? "It's yours. The call stays on record." : "It's yours. Marked with your name.");
          load();
        });
      } }, [live ? "I'm taking this call" : "I'll call them back"]) : null
    ]);

    shell.appendChild(head);
    shell.appendChild(slots);
    shell.appendChild(trailHost);
    shell.appendChild(el("div", { class: "body", style: "padding:0 18px" }, [err]));
    shell.appendChild(foot);
  }).catch(function (e) {
    shell.innerHTML = "";
    shell.appendChild(el("div", { class: "body" }, [el("div", { class: "err", role: "alert" }, [e.message || String(e)])]));
  });
}

/* --- calls -------------------------------------------------------------- */

/* Which steps are open. Collapsed by default: a call should read as a
   conversation first, and only become evidence when you ask it to. */
var openSteps = {};
var showQueries = false;

function toggleStep(id) { openSteps[id] = !openSteps[id]; if (traceRepaint) traceRepaint(); else render(); }

/**
 * One step of a call. The default view is who said what, and one line per
 * thing the agent did. Everything underneath is one click away on the step.
 */
function traceStep(e) {
  var at = hhmm(e.at);
  var open = !!openSteps[e.id];

  if (e.kind === "turn") {
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", {}, [el("div", { class: "role" }, [e.role === "agent" ? "Agent" : "Caller"]), el("div", { class: "said" }, [e.body || ""])])
    ]);
  }
  if (e.kind === "handoff") {
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", { class: "banner handoff" }, [
        el("span", { class: "k" }, ["Handed off"]),
        el("span", {}, [e.body || "to a person"]),
        (e.meta && e.meta.automatic) ? el("span", { class: "auto" }, ["by the safety check"]) : null
      ])
    ]);
  }
  if (e.kind === "change") {
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", { class: "banner" }, [el("span", { class: "k" }, ["Changed"]), el("span", {}, [e.body || ""])])
    ]);
  }
  if (e.kind === "refusal") {
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", { class: "banner" }, [el("span", { class: "k" }, ["Refused"]), el("span", {}, [e.body || ""])])
    ]);
  }
  if (e.kind === "tool") {
    var head = el("button", { class: "toolline" + (open ? " open" : ""), type: "button", "aria-expanded": open ? "true" : "false", onclick: function () { toggleStep(e.id); } }, [
      el("span", { class: "caret" }, [open ? "▾" : "▸"]),
      el("span", { class: "fn" }, [e.toolName || "lookup"]),
      el("span", { class: "plain" }, [DOING[e.toolName] || ""]),
      el("span", { class: "ms" }, [(e.durationMs || 0) + " ms"])
    ]);
    var body = null;
    if (open) {
      body = el("div", { class: "detail" }, [
        el("div", { class: "kv2" }, [el("span", { class: "k" }, ["asked"]), el("span", { class: "mono v" }, [e.args ? JSON.stringify(e.args) : "nothing"])]),
        el("div", { class: "kv2" }, [el("span", { class: "k" }, ["got back"]), el("span", { class: "v pre" }, [e.result || "(nothing)"])])
      ]);
    }
    return el("div", { class: "step" }, [el("span", { class: "at" }, [at]), el("div", {}, [head, body])]);
  }
  if (e.kind === "query") {
    if (!showQueries && !traceRepaint) return null;
    var qhead = el("button", { class: "toolline quiet" + (open ? " open" : ""), type: "button", "aria-expanded": open ? "true" : "false", onclick: function () { toggleStep(e.id); } }, [
      el("span", { class: "caret" }, [open ? "▾" : "▸"]),
      el("span", { class: "plain" }, ["Database"]),
      el("span", { class: "ms" }, [(e.rowCount === null ? "error" : e.rowCount + (e.rowCount === 1 ? " row" : " rows")) + ", " + (e.durationMs || 0) + " ms"])
    ]);
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", {}, [qhead, open ? el("div", { class: "detail" }, [el("span", { class: "v pre mono" }, [e.statement || ""])]) : null])
    ]);
  }
  if (e.kind === "reasoning" || e.kind === "decision") {
    var rhead = el("button", { class: "toolline quiet" + (open ? " open" : ""), type: "button", "aria-expanded": open ? "true" : "false", onclick: function () { toggleStep(e.id); } }, [
      el("span", { class: "caret" }, [open ? "▾" : "▸"]),
      el("span", { class: "plain" }, [e.kind === "reasoning" ? "Why it did that" : "Why it did that, our best guess"])
    ]);
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", {}, [rhead, open ? el("div", { class: "detail" }, [
        el("span", { class: "v think" }, [e.body || ""]),
        e.kind === "decision" ? el("span", { class: "warnline" }, ["The agent did not say this."]) : null
      ]) : null])
    ]);
  }
  if (e.kind === "proof") {
    return el("div", { class: "step" }, [
      el("span", { class: "at" }, [at]),
      el("div", { class: "proof" }, [
        el("span", { class: "k" }, ["Where that came from"]),
        el("q", {}, [e.body || ""]),
        el("span", { class: "from" }, [e.noteId ? "note " + e.noteId : "no note linked"])
      ])
    ]);
  }
  return el("div", { class: "step" }, [el("span", { class: "at" }, [at]), el("div", { class: "sub" }, [e.body || e.kind])]);
}

/** The facts the agent stated, with the note each rests on. */
function keyFacts(call) {
  var proofs = call.events.filter(function (e) { return e.kind === "proof"; });
  if (!proofs.length) return null;
  var box = el("div", { class: "pane" }, [el("span", { class: "eyebrow" }, ["Facts it used, and where from"])]);
  var seen = {};
  proofs.forEach(function (p) {
    if (seen[p.body]) return;
    seen[p.body] = 1;
    box.appendChild(el("div", { class: "proof" }, [el("q", {}, [p.body || ""]), el("span", { class: "from" }, [p.noteId ? "note " + p.noteId : "no note linked"])]));
  });
  return box;
}

/* A scripted rehearsal, by the same rule the rail uses: a web call the demo
   script labelled "demo:". A person typing into the test line is NOT one — their
   own call has to show up like any other. */
function isRehearsal(c) {
  return c.channel === "web" && /^demo:/.test(c.callerLabel || "");
}

function viewCalls() {
  var list = el("div", { class: "card scroll" });
  /* Customer calls first, rehearsals behind a click. Running the scripted demo
     a few times leaves dozens of its own calls in here, and a screen that is
     forty rows of test data reads as a product nobody has used. The rail has
     hidden them since the beginning; this list had not. */
  var rehearsals = state.calls.filter(isRehearsal);
  var shown = state.showDemoCalls ? state.calls : state.calls.filter(function (c) { return !isRehearsal(c); });
  if (!shown.length) list.appendChild(el("div", { class: "empty" }, [
    state.callsLoaded
      ? (rehearsals.length ? "No customer calls yet." : "No calls yet.")
      : "Reading"
  ]));
  shown.forEach(function (c) {
    var tags = [];
    if (c.status === "live") tags.push(el("span", { class: "livechip" }, [el("span", { class: "dot", "aria-hidden": "true" }), "live"]));
    if (c.handoffReason) tags.push(el("span", { class: "flag" }, ["Handed off"]));
    if (c.changeCount) tags.push(el("span", {}, [c.changeCount + (c.changeCount === 1 ? " change" : " changes")]));
    tags.push(el("span", {}, [c.turnCount + " turns, " + c.toolCount + " lookups" + (c.channel === "web" ? ", test line" : "")]));
    list.appendChild(el("button", {
      class: "row" + (state.call && state.call.id === c.id ? " on" : ""), type: "button",
      onclick: function () { go("calls", c.id); }
    }, [
      el("span", { class: "a" }, [c.address || c.callerLabel || c.fromNumber || "Unknown caller"]),
      el("span", { class: "t mono" }, [when(c.startedAt)]),
      el("span", { class: "b" }, tags)
    ]));
  });
  if (rehearsals.length) {
    list.appendChild(el("button", { class: "more", type: "button",
      onclick: function () { state.showDemoCalls = !state.showDemoCalls; render(); } },
      [state.showDemoCalls
        ? "Hide the " + rehearsals.length + " demo " + (rehearsals.length === 1 ? "call" : "calls")
        : "Show " + rehearsals.length + " demo " + (rehearsals.length === 1 ? "call" : "calls")]));
  }
  var left = el("div", { style: "display:flex;flex-direction:column;gap:10px;min-height:0" }, [
    el("input", {
      id: "call-search", name: "call-search", type: "search", autocomplete: "off",
      "aria-label": "Search calls", placeholder: "Number, address or job", value: state.callSearch,
      onchange: function () { state.callSearch = this.value; load(); }
    }),
    list
  ]);

  var detail;
  if (!state.call) {
    detail = el("div", { class: "card" }, [el("div", { class: "empty" }, [state.callsLoaded ? "Pick a call." : "Reading"])]);
  } else {
    var c = state.call;
    var head = el("div", { class: "hd" }, [
      el("div", { style: "min-width:0" }, [
        el("h2", {}, [c.address || c.callerLabel || c.fromNumber || "Unknown caller"]),
        el("div", { class: "meta" }, [
          el("span", {}, [c.channel === "web" ? "Test line" : "Phone"]),
          el("span", {}, [daystamp(c.startedAt) + ", " + hhmm(c.startedAt)]),
          c.durationMs ? el("span", {}, [Math.round(c.durationMs / 1000) + " seconds"]) : null,
          el("span", {}, [c.events.filter(function (e) { return e.kind === "turn"; }).length + " turns, " + c.events.filter(function (e) { return e.kind === "tool"; }).length + " lookups"]),
          c.status === "live" ? el("span", { class: "livechip" }, [el("span", { class: "dot", "aria-hidden": "true" }), "live"]) : null
        ])
      ]),
      el("div", { class: "r" }, [
        el("button", { class: "btn small", type: "button", "aria-pressed": showQueries ? "true" : "false", onclick: function () { showQueries = !showQueries; render(); } }, [showQueries ? "Hide the database" : "Show the database"]),
        /* The label says what the click will do. It always read "Open all",
           including when everything was already open and the click closed the
           lot. */
        (function () {
          var anyOpen = c.events.some(function (e) { return openSteps[e.id]; });
          return el("button", { class: "btn small", type: "button", onclick: function () {
            c.events.forEach(function (e) { openSteps[e.id] = !anyOpen; });
            render();
          } }, [anyOpen ? "Close all" : "Open all"]);
        })(),
        /* The whole call, out of the screen and into a file. This page is the
           one an auditor asks for, and until now there was no way to hand it
           over except a screenshot. Rows are one per step, in the order they
           happened, with the database question and its timing beside it. */
        el("button", { class: "btn small", type: "button", onclick: function () { exportCall(c); } }, ["Save this call"])
      ])
    ]);

    var changes = null;
    if (c.changes.length) {
      changes = el("div", { class: "pane" }, [el("span", { class: "eyebrow" }, ["What changed"])]);
      c.changes.forEach(function (ch) {
        changes.appendChild(el("div", { class: "wrote" }, [
          el("span", { style: "color:var(--ink)" }, [(ch.undoneAt ? "Undone: " : "") + (ch.jobRef ? "Job " + ch.jobRef + ", " : "") + (ch.summary || ch.kind)]),
          el("button", { class: "btn small", type: "button", style: "margin-left:auto", onclick: function () { go("job", ch.jobId); } }, ["Open the job"]),
          ch.undoable ? el("button", { class: "btn small", type: "button", onclick: function (ev) {
            ev.currentTarget.disabled = true;
            api("actions/undo", { method: "POST", body: { changeId: ch.id, by: who() } })
              .then(function () { toast("Undone."); load(); }).catch(function (e) { toast("Could not undo. " + e.message); load(); });
          } }, ["Undo"]) : null
        ]));
      });
    }
    var trace = el("div", { class: "trace" });
    var steps = c.events.map(traceStep).filter(Boolean);
    if (!steps.length) trace.appendChild(el("div", { class: "empty" }, ["Nothing recorded on this call."]));
    steps.forEach(function (n) { trace.appendChild(n); });
    detail = el("div", { class: "card" }, [head, el("div", { class: "scroll" }, [changes, keyFacts(c), trace])]);
  }
  return el("div", { class: "split" }, [left, detail]);
}

/* --- property ----------------------------------------------------------- */

/* Fetches one page of the register. Search is debounced because it runs against
   1,327 buildings and a keystroke is not a query. */
var propsTimer = null;
function loadProps(resetPage) {
  var P = state.props;
  if (resetPage) P.offset = 0;
  var qs = "properties?list=1&limit=" + P.limit + "&offset=" + P.offset +
    "&sort=" + P.sort + "&dir=" + P.dir +
    (P.q ? "&q=" + encodeURIComponent(P.q) : "") +
    (P.city ? "&city=" + encodeURIComponent(P.city) : "") +
    (P.only ? "&only=" + P.only : "");
  return api(qs).then(function (d) {
    P.rows = d.rows; P.total = d.total; P.loaded = true;
    if (d.cities && d.cities.length) P.cities = d.cities;
    render();
  }).catch(fail);
}
function propsSoon(resetPage) {
  if (propsTimer) clearTimeout(propsTimer);
  propsTimer = setTimeout(function () { propsTimer = null; loadProps(resetPage); }, 220);
}

var PROP_COLS = [
  ["address", "Address"], ["city", "City"], ["customer", "Account"],
  ["visits", "Visits"], ["last", "Last visit"], ["next", "Next visit"],
  ["owed", "Owed"], ["access", "Entry note"]
];
/* Only some columns have something to sort on in the database. Sorting a page
   of fifty by a column the server did not order by would be a lie. */
var PROP_SORTABLE = { address: 1, visits: 1, last: 1, next: 1, owed: 1 };

function propDay(iso) { return iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "—"; }

function exportProps() {
  var rows = state.props.rows.map(function (r) {
    return [r.address + (r.unit ? " #" + r.unit : ""), r.city || "", r.state || "", r.zip || "",
      r.customer || "", String(r.visits), r.lastVisitAt ? propDay(r.lastVisitAt) : (r.lastBookedAt ? propDay(r.lastBookedAt) + " (not marked finished)" : ""),
      r.nextVisitAt ? propDay(r.nextVisitAt) : "", r.openCents ? money(r.openCents) : "",
      String(r.openJobs), r.hasAccessNote ? "yes" : "no"];
  });
  download("properties-" + stamp() + ".csv",
    toCSV(["Address", "City", "State", "ZIP", "Account", "Visits", "Last visit", "Next visit",
           "Owed", "Open jobs", "Entry note on file"], rows), "text/csv");
  toast("Saved " + rows.length + " properties as a CSV file.");
}

function viewProperty() {
  if (!state.arg) {
    var P = state.props;
    if (!P.loaded) loadProps(false);

    var search = el("input", {
      type: "search", id: "prop-q", name: "prop-q", autocomplete: "off", spellcheck: "false",
      "aria-label": "Search by address or account", placeholder: "Address or account", value: P.q
    });
    search.oninput = function () { P.q = this.value; propsSoon(true); };

    var cityPick = el("select", { "aria-label": "City" },
      [el("option", { value: "" }, ["Every city"])].concat(P.cities.map(function (c) {
        return el("option", { value: c, selected: P.city === c ? "" : null }, [c]);
      })));
    cityPick.onchange = function () { P.city = this.value; loadProps(true); };

    var only = el("div", { class: "seg", role: "group", "aria-label": "Show" },
      [["", "All"], ["owing", "Owes money"], ["upcoming", "Visit booked"], ["quiet", "Nothing booked"]].map(function (o) {
        return el("button", { type: "button", class: P.only === o[0] ? "on" : "",
          "aria-pressed": P.only === o[0] ? "true" : "false",
          onclick: function () { P.only = o[0]; loadProps(true); } }, [o[1]]);
      }));

    var bar = el("div", { class: "bar" }, [
      search, cityPick, only,
      el("span", { class: "cnt mono" }, [P.loaded ? P.total.toLocaleString("en-US") + (P.total === 1 ? " building" : " buildings") : "counting"]),
      el("button", { class: "btn small", type: "button", disabled: P.rows.length ? null : "", onclick: exportProps }, ["Save this page"])
    ]);

    var head = el("tr", {}, PROP_COLS.map(function (c) {
      var can = PROP_SORTABLE[c[0]];
      var on = P.sort === c[0];
      if (!can) return el("th", {}, [c[1]]);
      return el("th", { "aria-sort": on ? (P.dir === "asc" ? "ascending" : "descending") : "none" }, [
        el("button", { type: "button", onclick: function () {
          if (P.sort === c[0]) P.dir = P.dir === "asc" ? "desc" : "asc";
          else { P.sort = c[0]; P.dir = c[0] === "address" ? "asc" : "desc"; }
          loadProps(true);
        } }, [c[1] + (on ? (P.dir === "asc" ? " \\u25b4" : " \\u25be") : "")])
      ]);
    }));

    var body = el("tbody", {});
    if (!P.loaded) body.appendChild(el("tr", {}, [el("td", { colspan: String(PROP_COLS.length) }, ["Reading the book"])]));
    else if (!P.rows.length) body.appendChild(el("tr", {}, [el("td", { colspan: String(PROP_COLS.length) }, ["No building matches that."])]));
    P.rows.forEach(function (r) {
      var tr = el("tr", { tabindex: "0", role: "link", class: "click",
        onclick: function () { go("property", r.id); },
        onkeydown: function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go("property", r.id); } } }, [
        el("td", {}, [(r.address || "No address on file") + (r.unit ? " #" + r.unit : "")]),
        el("td", { class: "dim" }, [r.city || "—"]),
        el("td", {}, [r.customer || "—"]),
        el("td", { class: "mono" }, [String(r.visits)]),
        /* A finished visit reads plainly. A day we were booked but never marked
           finished reads muted, with the reason on hover — it is not the same
           fact and must not look like one. */
        r.lastVisitAt
          ? el("td", { class: "dim mono" }, [propDay(r.lastVisitAt)])
          : el("td", { class: "dim mono", style: "font-style:italic",
                title: "Booked for this day. Nobody marked the visit finished." },
              [r.lastBookedAt ? propDay(r.lastBookedAt) : "\\u2014"]),
        el("td", { class: "mono" }, [propDay(r.nextVisitAt)]),
        el("td", { class: "mono" + (r.openCents ? " owed" : " dim") }, [r.openCents ? money(r.openCents) : "—"]),
        el("td", { class: "dim" }, [r.hasAccessNote ? "on file" : "—"])
      ]);
      body.appendChild(tr);
    });

    var from = P.total ? P.offset + 1 : 0, to = Math.min(P.offset + P.limit, P.total);
    var pager = el("div", { class: "bar" }, [
      el("span", { class: "cnt mono" }, [P.total ? from.toLocaleString("en-US") + "\\u2013" + to.toLocaleString("en-US") + " of " + P.total.toLocaleString("en-US") : ""]),
      el("button", { class: "btn small", type: "button", disabled: P.offset > 0 ? null : "",
        onclick: function () { P.offset = Math.max(0, P.offset - P.limit); loadProps(false); } }, ["Back"]),
      el("button", { class: "btn small", type: "button", disabled: to < P.total ? null : "",
        onclick: function () { P.offset = P.offset + P.limit; loadProps(false); } }, ["Next"])
    ]);

    return el("div", { class: "card", style: "display:flex;flex-direction:column;min-height:0" }, [
      bar,
      el("div", { class: "scrollx scroll", style: "flex:1;min-height:0" }, [
        el("table", { class: "list" }, [el("thead", {}, [head]), body])
      ]),
      pager
    ]);
  }
  if (!state.property) return el("div", { class: "skel" }, ["Loading"]);

  var d = state.property;

  /* The read-it-while-the-phone-rings version. Everything it says is on the
     page underneath it, with sources; this is the part somebody has time for. */
  if (!state.brief || state.brief.propertyId !== d.property.id) {
    state.brief = { propertyId: d.property.id, loading: true, text: null };
    /* A BARE fetch, on purpose. The shared api() helper is wired into the page's
       error handling, and a briefing that could not be written must never take
       the record down with it — everything the briefing says is on the page
       underneath it anyway. Nothing here can throw into the render. */
    (function (pid) {
      fetch("/data/property/" + pid + "?brief=1&k=" + encodeURIComponent(KEY))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (b) {
          if (!state.brief || state.brief.propertyId !== pid) return;
          state.brief = { propertyId: pid, loading: false, text: (b && b.brief) || null };
          try { render(); } catch (e) { /* never a fatal briefing */ }
        });
    })(d.property.id);
  }

  /* Every kind of thing the record holds about a building, in the order a
     dispatcher wants it, with a heading a person would use out loud. The raw
     key is what the extractor called it; nobody at a desk says "units". */
  var FACT_GROUPS = [
    ["policy",   "Standing rules"],
    ["access",   "Getting in"],
    ["contacts", "Who to ask for"],
    ["units",    "What is installed"],
    ["warranty", "Warranty"],
    ["parts",    "Parts"]
  ];

  /* One fact, in a sentence. The payloads are extractor output — nested keys,
     nulls, internal ids — and printing them raw ("kind: door_code · value:
     [code] · job_id: 10510") is showing somebody the inside of the machine. */
  function factLine(kind, f) {
    var pay = f.payload || {};
    if (kind === "access") {
      var what = String(pay.kind || "access").replace(/_/g, " ");
      what = what.charAt(0).toUpperCase() + what.slice(1);
      var v = pay.value == null ? "" : String(pay.value);
      /* THE CODE ITSELF, FOR THE PERSON AT THE DESK.
         The agent never sees this — entry codes are stripped before anything
         reaches the model, and refusing to read one out is the headline
         boundary. A dispatcher is not a caller: they are the person the agent
         hands to, and hiding it from them too would make the screen useless at
         the one moment it matters. Where the export kept a real value it is
         shown; where the anonymiser took it, the screen says so rather than
         printing a placeholder and letting somebody read "[code]" down a phone. */
      if (v && v !== "[code]" && v.indexOf("[code]") < 0) return what + ": " + v;
      if (pay.value_known || v) return what + " on file — the code itself was removed from this export.";
      if (pay.detail) return String(pay.detail);
      return f.snippet || what;
    }
    if (kind === "contacts") {
      var who = pay.name ? String(pay.name) : null;
      var role = pay.role ? String(pay.role).replace(/_/g, " ") : null;
      var co = pay.company ? String(pay.company) : null;
      var bits = [who, role && who ? "(" + role + ")" : role, co ? "at " + co : null].filter(Boolean);
      var line = bits.join(" ") || "A contact";
      if (pay.has_phone) line += " — phone on file";
      return line;
    }
    if (kind === "units") {
      var id = pay.identifier ? String(pay.identifier) : "";
      var k = pay.kind ? String(pay.kind).replace(/_/g, " ") : "";
      return [id, k && id ? "(" + k + ")" : k].filter(Boolean).join(" ") || (f.snippet || "");
    }
    if (kind === "warranty") return String(pay.claim || f.snippet || "");
    return f.snippet || Object.keys(pay).filter(function (x) { return x !== "_scrub" && pay[x]; })
      .map(function (x) { return x.replace(/_/g, " ") + ": " + pay[x]; }).join(" · ");
  }

  var known = el("div", {});
  var anyFact = false;
  FACT_GROUPS.forEach(function (g) {
    var list = (g[0] === "policy" ? (d.policies || []) : ((d.facts && d.facts[g[0]]) || []));
    if (!list.length) return;
    anyFact = true;
    known.appendChild(el("div", { class: "card-h" }, [
      el("h2", {}, [g[1]]), el("span", { class: "n" }, [String(list.length)])
    ]));
    list.forEach(function (f) {
      var src = f.sources && f.sources.length ? f.sources : [{ noteId: f.noteId, jobRef: f.jobRef, snippet: f.snippet }];
      var isCode = g[0] === "access" && /code/.test(String((f.payload || {}).kind || ""));
      known.appendChild(el("div", { class: "kfact" + (isCode ? " code" : "") }, [
        el("div", { class: "val" }, [factLine(g[0], f)]),
        /* Where it came from, every time — a fact with no source is a rumour,
           and this record was read out of handwritten notes. The office often
           wrote the same thing down several times; the quote shown is the first,
           and the rest are counted rather than repeated. */
        el("div", { class: "src" }, [
          src[0] && src[0].snippet ? el("q", {}, [src[0].snippet]) : null,
          el("span", { class: "from" }, [
            src[0] && src[0].noteId ? el("span", {}, ["note " + src[0].noteId]) : null,
            src[0] && src[0].jobRef ? el("button", { class: "lnk", type: "button", onclick: (function (ref) {
              return function () { var j = (d.jobs || []).filter(function (x) { return x.jobRef === ref; })[0]; if (j) go("job", j.id); };
            })(src[0].jobRef) }, ["job " + src[0].jobRef]) : null,
            src.length > 1 ? el("span", { title: src.map(function (s) { return "note " + s.noteId; }).join(", ") },
              ["written down " + src.length + " times"]) : null
          ].filter(Boolean))
        ])
      ]));
    });
  });
  if (!anyFact) known.appendChild(el("div", { class: "empty" }, ["Nothing on file for this building yet."]));

  /* Every visit, not the last twelve, with what the office wrote on each. */
  var visits = el("div", {});
  if (!d.jobs.length) visits.appendChild(el("div", { class: "empty" }, ["No visits on record."]));
  d.jobs.forEach(function (j) {
    var when = j.completedAt ? daystamp(j.completedAt)
      : j.scheduledStart ? daystamp(j.scheduledStart) + (j.completedAt ? "" : " (booked)") : "no date";
    var state2 = j.isCanceled ? "canceled" : j.completedAt ? "done" : j.startedAt ? "under way" : "booked";
    var head = el("button", { class: "row", type: "button", onclick: function () { go("job", j.id); } }, [
      el("span", { class: "a" }, [j.description || j.serviceCode || "Service call"]),
      el("span", { class: "t mono" }, [when]),
      el("span", { class: "b" }, [
        el("span", { class: "mono" }, ["job " + j.jobRef]),
        el("span", {}, [state2]),
        j.employees && j.employees.length ? el("span", {}, [j.employees.join(", ")]) : null,
        j.totalCents ? el("span", { class: "mono" }, [money(j.totalCents)]) : null
      ].filter(Boolean))
    ]);
    visits.appendChild(head);
    (j.notes || []).forEach(function (n) {
      visits.appendChild(el("div", { class: "jnote" }, [
        el("q", {}, [String(n.content || "").replace(/\\s+/g, " ").trim()]),
        el("span", { class: "from" }, ["note " + n.id])
      ]));
    });
  });

  var street = d.property.street + (d.property.unit ? " unit " + d.property.unit : "");
  return el("div", { class: "split", style: "grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)" }, [
    el("div", { class: "card" }, [
      el("div", { class: "hd" }, [
        el("div", {}, [
          el("h2", {}, [street]),
          el("div", { class: "meta" }, [
            el("span", {}, [[d.property.city, d.property.zip].filter(Boolean).join(" ") || "no city on file"]),
            /* Who the account is, and what kind. 53.8% of this book's work comes
               from property managers, so "who owns this" and "who rang" are
               different questions and the page should not blur them. */
            (d.customers || []).length
              ? el("span", {}, [d.customers.map(function (c) {
                  return c.displayName + (c.derivedKind ? " · " + String(c.derivedKind).replace(/_/g, " ") : "");
                }).join("; ")])
              : el("span", {}, ["no account on file"])
          ])
        ]),
        el("div", { class: "r" }, [el("button", { class: "btn key", type: "button", onclick: function () { bookDialog({ propertyId: d.property.id, address: street }); } }, ["Book here"])])
      ]),
      el("dl", { class: "stats" }, [
        el("div", {}, [el("dt", {}, ["Visits"]), el("dd", { class: "num" }, [String(d.property.visitCount)])]),
        el("div", {}, [el("dt", {}, ["Last visit"]),
          d.property.lastVisitAt
            ? el("dd", {}, [daystamp(d.property.lastVisitAt)])
            : el("dd", { title: "Booked, but nobody marked a visit finished." }, ["none marked done"])]),
        el("div", {}, [el("dt", {}, ["Next visit"]), el("dd", {}, [daystamp(d.property.nextVisitAt) || "none booked"])]),
        el("div", {}, [el("dt", {}, ["Money owed"]), el("dd", { class: "num" }, [money(d.balance.openCents)])]),
        el("div", {}, [el("dt", {}, ["Open invoices"]), el("dd", { class: "num" }, [String(d.balance.openInvoices)])])
      ]),
      (function () {
        var B = state.brief;
        if (!B || B.propertyId !== d.property.id) return null;
        if (B.loading) return el("div", { class: "insight", style: "margin:0 16px 14px" }, ["Reading the file"]);
        if (!B.text) return null;   /* no briefing is quieter than a broken one */
        return el("div", { class: "insight", style: "margin:0 16px 14px" }, [B.text]);
      })(),
      el("div", { class: "card-h" }, [el("h2", {}, ["Visits, newest first"]), el("span", { class: "n" }, [String(d.jobs.length)])]),
      el("div", { class: "scroll" }, [visits]),
      /* What the record does and does not cover, said once, at the bottom. */
      el("div", { class: "note", style: "padding:10px 16px" }, [
        "Records start March 2026. " +
        (d.meta ? d.meta.notesIncluded + " note" + (d.meta.notesIncluded === 1 ? "" : "s") + " read" +
          (d.meta.notesOmitted ? ", " + d.meta.notesOmitted + " older ones left out for length." : ".") : "")
      ])
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "hd" }, [el("h2", {}, ["What we know"]),
        el("div", { class: "meta" }, [el("span", {}, ["Every line says where it came from"])])]),
      el("div", { class: "scroll" }, [known])
    ])
  ]);
}

/* --- job ---------------------------------------------------------------- */

function viewJob() {
  if (!state.arg) return el("div", { class: "card" }, [el("div", { class: "empty" }, ["Open a job from the board or a call."])]);
  if (!state.job) return el("div", { class: "skel" }, ["Loading"]);
  var j = state.job;
  var jj = { id: j.id, jobRef: j.jobRef, customer: j.customer, address: j.address, unit: j.unit, description: j.description, isCanceled: j.isCanceled,
    scheduledStart: j.scheduledStart, scheduledEnd: j.scheduledEnd, startedAt: j.startedAt, completedAt: j.completedAt, lateMinutes: j.lateMinutes,
    technicians: j.assigned, employeeId: j.assigned.length ? j.assigned[0].id : null, day: j.scheduledStart ? dayOf(j.scheduledStart) : null };

  var hist = el("div", { class: "hist" });
  if (!j.entries.length) hist.appendChild(el("div", { class: "sub" }, ["Nothing on this job yet."]));
  j.entries.forEach(function (e) {
    hist.appendChild(el("div", {}, [
      el("div", { class: "m" }, [el("b", {}, [e.author === "agent" ? "Agent" : (e.authorName || "Office")]), daystamp(e.at) + " " + hhmm(e.at)]),
      el("div", { class: "x" }, [
        e.body,
        e.undoable ? el("div", { class: "wrote" }, [
          el("span", {}, ["Undo is open until the technician starts the job."]),
          el("button", { class: "btn small", type: "button", onclick: function (ev) {
            ev.currentTarget.disabled = true;
            api("actions/undo", { method: "POST", body: { changeId: e.changeId, by: who() } })
              .then(function () { toast("Undone."); load(); }).catch(function (x) { toast("Could not undo. " + x.message); load(); });
          } }, ["Undo"])
        ]) : null,
        e.callId ? el("div", { style: "margin-top:6px" }, [el("button", { class: "btn small", type: "button", onclick: function () { go("calls", e.callId); } }, ["Open the call"])]) : null
      ])
    ]));
  });

  var st = statusOf(jj);
  return el("div", { class: "split", style: "grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)" }, [
    el("div", { class: "card" }, [
      el("div", { class: "hd" }, [
        el("div", { style: "min-width:0" }, [
          el("h2", {}, [(j.jobRef ? "Job " + j.jobRef + " · " : "") + (j.address || "no address") + (j.unit ? " #" + j.unit : "")]),
          el("div", { class: "meta" }, [
            el("span", {}, [j.description || "Service call"]),
            el("span", {}, [j.customer || "no customer on file"]),
            el("span", { class: st.cls }, [st.text])
          ])
        ]),
        el("div", { class: "r" }, [el("button", { class: "btn key", type: "button", onclick: function () { jobDialog(jj); } }, ["Edit"])])
      ]),
      el("dl", { class: "stats" }, [
        el("div", {}, [el("dt", {}, ["When"]), el("dd", {}, [j.scheduledStart ? daystamp(j.scheduledStart) + " " + hhmm(j.scheduledStart) : "no time yet"])]),
        el("div", {}, [el("dt", {}, ["Technician"]), el("dd", {}, [j.assigned.length ? j.assigned.map(function (a) { return a.name; }).join(", ") : "Nobody"])]),
        el("div", {}, [el("dt", {}, ["Started"]), el("dd", {}, [j.startedAt ? hhmm(j.startedAt) : "not yet"])]),
        el("div", {}, [el("dt", {}, ["Money owed"]), el("dd", { class: "num" }, [j.invoice ? money(j.invoice.dueCents) : "no invoice"])])
      ]),
      el("div", { class: "scroll" }, [el("div", { class: "pane" }, [el("span", { class: "eyebrow" }, ["History"]), hist])])
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "hd" }, [el("h2", {}, ["Actions"])]),
      el("div", { class: "pane", style: "display:flex;flex-direction:column;gap:8px;align-items:flex-start" }, [
        j.isCanceled ? el("span", { class: "sub" }, ["This visit was canceled."]) : el("button", { class: "btn", type: "button", onclick: function () { lateDialog(jj); } }, ["Running late"]),
        el("button", { class: "btn", type: "button", onclick: function () { noteDialog(jj); } }, ["Add a note"]),
        j.propertyId ? el("button", { class: "btn", type: "button", onclick: function () { go("property", j.propertyId); } }, ["Open the property"]) : null,
        j.isCanceled ? null : el("button", { class: "btn stop", type: "button", style: "margin-top:10px", onclick: function () { cancelDialog(jj); } }, ["Cancel the visit"])
      ])
    ])
  ]);
}

/* --- catch up ----------------------------------------------------------- */

function viewCatchup() {
  if (!state.queues.length) return el("div", { class: "skel" }, ["Counting"]);
  var lists = el("div", { class: "card" });
  state.queues.forEach(function (q) {
    lists.appendChild(el("button", { class: "qrow2" + (state.queueName === q.name ? " on" : ""), type: "button", disabled: q.pending ? "" : null,
      onclick: function () { state.queueName = q.name; load(); } }, [
      el("span", { class: "n" + (q.pending ? " dim" : "") }, [q.pending ? "Not counted yet" : String(q.count)]),
      el("span", { style: "flex:1;min-width:0" }, [el("div", { class: "l" }, [q.title]), el("div", { class: "s" }, [q.note + (q.amountCents ? " Worth " + money(q.amountCents) + "." : "")])]),
      q.pending ? null : el("span", { class: "btn small" }, ["Open list"])
    ]));
  });

  var items = null;
  if (state.queueName) {
    var q = state.queues.filter(function (x) { return x.name === state.queueName; })[0];
    items = el("div", { class: "card" }, [
      el("div", { class: "card-h" }, [
        el("h2", {}, [q ? q.title : state.queueName]),
        el("span", { class: "n" }, [String(state.queueItems.length)]),
        /* Working a backlog down happens in a spreadsheet, not by scrolling a
           web page. 150 finished-but-never-billed jobs is a morning's work for
           somebody, and until now there was no way to get the list out. */
        state.queueItems.length
          ? el("button", { class: "btn small", type: "button", style: "margin-left:auto",
              onclick: function () { exportQueue(q, state.queueItems); } }, ["Save this list"])
          : null
      ])
    ]);
    if (!state.queueItems.length) items.appendChild(el("div", { class: "empty" }, ["Nothing on this list."]));
    state.queueItems.forEach(function (it) {
      var owner = el("select", { "aria-label": "Who owns this" }, [el("option", { value: "" }, ["Nobody"])].concat(
        state.techs.map(function (t) { return el("option", { value: String(t.id), selected: it.ownerId === t.id ? "" : null }, [t.name]); })
      ));
      var due = el("input", { type: "date", "aria-label": "Due", value: it.dueOn || "" });
      function save() {
        api("queues/" + state.queueName + "/assign", { method: "POST", body: {
          subjectType: it.subjectType, subjectId: it.subjectId,
          ownerId: owner.value ? Number(owner.value) : null, dueOn: due.value || null
        } }).then(function () { toast("Saved."); load(); }).catch(function (e) { toast("Not saved. " + e.message); });
      }
      owner.onchange = save; due.onchange = save;
      items.appendChild(el("div", { class: "qitem" }, [
        el("span", { class: "l mono" }, [it.label]),
        el("span", { class: "d" }, [it.detail + (it.amountCents ? ", " + money(it.amountCents) : "")]),
        el("span", { class: "c" }, [
          owner, due,
          it.subjectType === "job" ? el("button", { class: "btn small", type: "button", onclick: function () { go("job", it.subjectId); } }, ["Open"]) : null,
          el("button", { class: "btn small", type: "button", onclick: function () { dismissQueueItemDialog(it); } }, ["Take off the list"])
        ])
      ]));
    });
  }
  return [lists, items];
}

function dismissQueueItemDialog(it) {
  var note = el("textarea", { id: "dq-body", rows: "3" });
  var err = errBox();
  overlay(veil([
    el("div", { class: "modal" }, [
      el("div", { class: "body" }, [
        el("h3", {}, ["Take this off the list?"]),
        el("p", { class: "sub" }, [it.label + (it.detail ? ", " + it.detail : "") + ". Your reason goes on the record with your name."]),
        labelled("dq-body", "Why?", note),
        err
      ]),
      el("div", { class: "foot" }, [
        el("button", { class: "btn", type: "button", onclick: function () { overlay(null); } }, ["Keep it"]),
        el("button", { class: "btn key", type: "button", onclick: function (ev) {
          var r = note.value.trim();
          if (!r) { err.textContent = "Give a reason."; err.hidden = false; note.focus(); return; }
          runAction(ev.currentTarget, err, "Saving", function () {
            return api("queues/" + state.queueName + "/dismiss", { method: "POST", body: { subjectType: it.subjectType, subjectId: it.subjectId, reason: who() + ": " + r } });
          }, function () { toast("Taken off the list."); load(); });
        } }, ["Take it off"])
      ])
    ])
  ]));
}

/* --- test line ---------------------------------------------------------- */

function viewTest() {
  var cfg = state.config && state.config.voice;
  var ready = cfg && cfg.publicKey && cfg.assistantId;
  var control;
  if (!ready) {
    control = el("span", { class: "sub" }, ["The test line is not set up. It needs VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID."]);
  } else if (live.status === "idle") {
    control = el("div", { class: "ctl" }, [
      el("button", { class: "btn key big", type: "button", onclick: function () { startLiveCall(cfg); } }, ["Call"]),
      el("span", { class: "sub" }, ["Press Call and allow the microphone."])
    ]);
  } else {
    var onAir = live.status === "live" || live.status === "speaking" || live.status === "listening";
    control = el("div", { class: "ctl" }, [
      el("span", { "aria-live": "polite" }, [onAir
        ? el("span", { class: "livechip" }, [el("span", { class: "dot", "aria-hidden": "true" }), "live"])
        : el("span", { class: "sub" }, [LIVE_LABEL[live.status] || live.status])]),
      el("button", { class: "btn", type: "button", onclick: toggleMute, "aria-pressed": live.muted ? "true" : "false" }, [live.muted ? "Unmute" : "Mute"]),
      el("button", { class: "btn big live", type: "button", onclick: stopLiveCall }, ["Hang up"])
    ]);
  }
  var lead = el("div", { class: "lead" }, [
    el("h2", {}, ["Call the agent yourself"]),
    el("p", {}, ["The same agent the phone number answers with, over your microphone. Everything said, looked up and changed is kept in Calls."]),
    control
  ]);
  var items = liveStream();
  var stream = el("div", { class: "convo" });
  if (!items.length) stream.appendChild(el("div", { class: "empty", style: "padding:0" }, [live.status === "idle" ? "Nothing yet." : "Connected. Say something."]));
  items.forEach(function (it) { stream.appendChild(bubble(it)); });
  if (live.error) stream.appendChild(el("div", { class: "err", role: "alert" }, [live.error]));
  var box = el("div", { class: "card", style: "flex:1;min-height:200px;display:flex;flex-direction:column" }, [
    stream,
    el("div", { class: "convo-foot" }, [
      el("button", { class: "btn small", type: "button", style: "margin-left:auto", onclick: function () { go("calls"); } }, [live.callId ? "See it in Calls" : "Open Calls"])
    ])
  ]);
  return el("div", { class: "talk" }, [lead, box]);
}

/* What the agent is doing, in the office's words. */
var DOING = {
  resolve_property: "Finding the property",
  get_service_history: "Reading the visit history",
  get_access: "Checking the access notes",
  get_contacts: "Looking up who to call",
  get_balance: "Checking what is owed",
  get_warranty_evidence: "Checking the warranty",
  move_job: "Moving the visit",
  book_job: "Booking the visit",
  cancel_job: "Canceling the visit",
  add_note: "Writing a note on the job",
  handoff: "Getting a person"
};

function liveStream() {
  var out = [];
  live.lines.forEach(function (l) { out.push({ kind: l.role === "agent" ? "agent" : "caller", text: l.text, at: l.at }); });
  (live.trace || []).forEach(function (e) {
    if (e.kind === "tool") out.push({ kind: "doing", text: DOING[e.toolName] || e.toolName, at: e.at, ms: e.durationMs });
    else if (e.kind === "change") out.push({ kind: "change", text: e.body, at: e.at });
    else if (e.kind === "handoff") out.push({ kind: "handoff", text: e.body, at: e.at });
    else if (e.kind === "refusal") out.push({ kind: "refusal", text: "Refused", at: e.at });
  });
  out.sort(function (a, b) { return String(a.at || "").localeCompare(String(b.at || "")); });
  return out;
}

function bubble(it) {
  if (it.kind === "caller" || it.kind === "agent") {
    return el("div", { class: "say " + it.kind }, [el("span", { class: "who" }, [it.kind === "agent" ? "Agent" : "You"]), el("span", { class: "words" }, [it.text])]);
  }
  if (it.kind === "doing") {
    return el("div", { class: "doing" }, [el("span", { class: "lbl" }, ["Looking up"]), el("span", {}, [it.text]), it.ms ? el("span", { class: "ms" }, [it.ms + " ms"]) : null]);
  }
  if (it.kind === "change") return el("div", { class: "doing" }, [el("span", { class: "lbl" }, ["Changed"]), el("span", {}, [it.text])]);
  if (it.kind === "refusal") return el("div", { class: "doing held" }, [el("span", { class: "lbl" }, ["Refused"]), el("span", {}, ["It would not do that."])]);
  return el("div", { class: "doing held" }, [el("span", { class: "lbl" }, ["Handed off"]), el("span", {}, [it.text || "to a person"])]);
}

/* --- the real stack, in this tab -----------------------------------------
   A genuine Vapi call over WebRTC, with no telephone involved. It is the
   exact production path; only the transport differs from the published
   number, which is why the whole call lands on the Calls screen the same way.
------------------------------------------------------------------------- */

var live = { sdk: null, call: null, status: "idle", callId: null, lines: [], trace: [], error: null, muted: false };

setInterval(function () {
  if (document.hidden || !live.callId) return;
  api("calls?provider=" + encodeURIComponent(live.callId))
    .then(function (c) {
      live.trace = c.events.filter(function (e) { return e.kind === "tool" || e.kind === "change" || e.kind === "handoff" || e.kind === "refusal"; });
      if (state.view === "test") render();
    })
    .catch(function () { /* not written yet */ });
}, 1200);

/* The SDK ships as CommonJS and the CDN wraps it for ESM, so the constructor
   arrives nested. Walking down to the first thing that is actually a
   function survives that, and survives the CDN changing its wrapper. */
function resolveConstructor(mod) {
  var candidates = [mod && mod.default, mod && mod.Vapi, mod];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var depth = 0;
    while (c && typeof c !== "function" && c.default && depth < 5) { c = c.default; depth++; }
    if (typeof c === "function") return c;
  }
  return null;
}

var LIVE_LABEL = { idle: "Not connected", loading: "Loading", connecting: "Connecting", live: "Connected", speaking: "Agent speaking", listening: "Listening", ending: "Ending" };

async function startLiveCall(cfg) {
  try {
    live.status = "loading"; live.error = null; live.lines = []; live.trace = []; live.callId = null; render();
    var mod = null;
    if (!live.sdk) {
      mod = await import("https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.7.0/+esm");
      live.sdk = resolveConstructor(mod);
    }
    if (typeof live.sdk !== "function") {
      throw new Error("Could not load the voice software. It sent: " + Object.keys(mod || {}).join(", ") + " (default is " + typeof (mod && mod.default) + ").");
    }
    var v = new live.sdk(cfg.publicKey);
    live.call = v;
    v.on("call-start", function () { live.status = "live"; render(); });
    v.on("speech-start", function () { live.status = "speaking"; render(); });
    v.on("speech-end", function () { live.status = "live"; render(); });
    v.on("call-end", function () {
      live.status = "idle"; live.call = null; render();
      setTimeout(function () { if (state.view === "calls") load(); }, 2000);
    });
    v.on("error", function (e) {
      live.status = "idle";
      live.error = (e && (e.errorMsg || e.error || e.message)) || "The call could not start.";
      render();
    });
    v.on("message", function (m) {
      if (!m) return;
      if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
        live.lines.push({ role: m.role === "assistant" ? "agent" : "caller", text: m.transcript, at: new Date().toISOString() });
        render();
      }
    });
    live.status = "connecting"; render();
    var started = await v.start(cfg.assistantId);
    if (started && started.id) { live.callId = started.id; render(); }
  } catch (e) {
    live.status = "idle";
    live.error = (e && e.message) || String(e);
    render();
  }
}
function stopLiveCall() {
  live.status = "ending"; render();
  try { if (live.call) live.call.stop(); } catch (e) { /* already gone */ }
  live.status = "idle"; live.call = null; render();
}
function toggleMute() {
  try { live.muted = !live.muted; if (live.call) live.call.setMuted(live.muted); } catch (e) { /* not supported */ }
  render();
}

/* --- ask ------------------------------------------------------------------ */
/* Two ways to get at the record without writing a query: a filter over rows
   this screen already fetched, or a question in plain words, which the
   agent's model turns into one read-only query on the server. */

var ENTITIES = {
  jobs: {
    label: "Jobs, next 30 days",
    cols: ["Day", "Time", "Customer", "Address", "What", "Technician", "Status", "Booked by"],
    load: function () {
      return api("board?from=" + todayLocal() + "&to=" + addDays(todayLocal(), 30)).then(function (s) {
        return s.jobs.map(function (j) {
          return [j.day, j.scheduledStart ? hhmm(j.scheduledStart) : "", j.customer || "", (j.address || "") + (j.unit ? " #" + j.unit : ""),
            j.description || "", techNames(j) || "nobody", statusOf(j).text, j.byAgent ? "agent" : "office"];
        });
      });
    }
  },
  calls: {
    label: "Calls, latest 200",
    cols: ["Date", "Time", "Caller", "Line", "Turns", "Lookups", "Changes", "Handoff", "Status"],
    load: function () {
      return api("calls?limit=200").then(function (list) {
        return list.map(function (c) {
          return [daystamp(c.startedAt), hhmm(c.startedAt), c.address || c.callerLabel || c.fromNumber || "unknown",
            c.channel === "web" ? "test line" : "phone", String(c.turnCount), String(c.toolCount), String(c.changeCount),
            c.handoffReason ? c.handoffReason.replace(/_/g, " ") : "none", c.status];
        });
      });
    }
  },
  catchup: {
    label: "Catch up lists",
    cols: ["List", "Item", "Detail", "Amount", "Owner", "Due"],
    load: function () {
      var names = ["finished_not_billed", "written_never_sent", "booked_no_tech", "needs_scheduling"];
      return Promise.all(names.map(function (n) { return api("queues/" + n); })).then(function (lists) {
        var rows = [];
        lists.forEach(function (items, i) { items.forEach(function (it) {
          rows.push([names[i].replace(/_/g, " "), it.label, it.detail || "", it.amountCents === null ? "" : money(it.amountCents), it.ownerName || "", it.dueOn || ""]);
        }); });
        return rows;
      });
    }
  }
};
var OPS = ["is", "is not", "contains", "more than", "less than"];
var askData = {};

function askDialog(tab) {
  if (document.getElementById("overlay").firstChild) return;
  var A = state.ask;
  if (tab) A.tab = tab;
  var tabs = el("div", { class: "card-h", role: "tablist", style: "gap:0;padding:8px 12px" });
  var body = el("div", {});
  var foot = el("div", { class: "foot" });
  var modal = el("div", { class: "modal wide" }, [tabs, body, foot]);
  overlay(veil([modal]));

  function paintTabs() {
    tabs.innerHTML = "";
    var t = el("div", { class: "tabs" });
    [["question", "Ask a question"], ["filter", "Build a filter"]].forEach(function (x) {
      t.appendChild(el("button", { role: "tab", type: "button", class: A.tab === x[0] ? "on" : "", "aria-selected": A.tab === x[0] ? "true" : "false",
        onclick: function () { A.tab = x[0]; paintTabs(); paint(); } }, [x[1]]));
    });
    tabs.appendChild(t);
    tabs.appendChild(el("span", { class: "r" }, [el("button", { class: "btn small", type: "button", onclick: function () { overlay(null); } }, ["Close"])]));
  }
  /* A column name arrives as the database wrote it — total_owed_dollars. That
     is a field name, not a heading, and the person reading it asked a question
     in English. The real name stays on the row for anyone checking the query. */
  function heading(c) {
    var s = String(c).replace(/_/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function resultTable(cols, rows) {
    var t = el("table", { class: "list" }, [el("thead", {}, [el("tr", {}, cols.map(function (c) {
      return el("th", { title: String(c) }, [heading(c)]);
    }))])]);
    var b = el("tbody");
    rows.forEach(function (r) { b.appendChild(el("tr", { style: "cursor:default" }, r.map(function (v) { return el("td", {}, [v === null || v === undefined ? "" : String(v)]); }))); });
    t.appendChild(b);
    return el("div", { class: "out" }, [t]);
  }
  function exportButtons(name, cols, rows) {
    return [
      /* The file matches the screen: same headings, same formatted numbers.
         Saving a tidy table and opening a column of 563524.050000000000 is a
         surprise nobody needs. */
      el("button", { class: "btn small", type: "button", onclick: function () { download(name + "-" + stamp() + ".csv", toCSV(cols.map(heading), rows), "text/csv"); toast("Saved " + rows.length + " rows as a CSV file."); } }, ["Save as CSV"]),
      el("button", { class: "btn small", type: "button", onclick: function () { download(name + "-" + stamp() + ".json", JSON.stringify({ columns: cols, rows: rows }, null, 2)); toast("Saved " + rows.length + " rows as a JSON file."); } }, ["Save as JSON"])
    ];
  }
  /* Postgres hands a NUMERIC back as a string at full scale, so a total came
     out of the box as 563524.050000000000. That is the database's storage
     format, not an amount anybody can read.

     Three cases, and the unit is only asserted where it is actually known:
       - a column named ..._cents holds cents, so it is divided and shown as money
       - a money-sounding column with a fractional part is already dollars
       - anything else numeric just gets its dead zeros trimmed and its
         thousands marked, with no currency claimed */
  var MONEYISH = /(^|_)(amount|total|owed|balance|due|paid|revenue|price|cost|value|invoiced?)(_|$)/i;
  function cell(v, col) {
    if (typeof v === "string" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(v)) return daystamp(v) + " " + hhmm(v);
    var name = String(col || "");
    if ((typeof v === "string" && /^-?\\d+(\\.\\d+)?$/.test(v)) || typeof v === "number") {
      var n = Number(v);
      if (!isFinite(n)) return v;
      if (/(^|_)cents(_|$)/i.test(name)) return money(Math.round(n));
      if (MONEYISH.test(name) && String(v).indexOf(".") >= 0) {
        return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    }
    return v;
  }
  function paintQuestion() {
    var input = el("input", { type: "search", id: "ask-q", "aria-label": "Ask a question about the record", autocomplete: "off",
      placeholder: "Which jobs this week have nobody assigned? Who owes us more than $500?", value: A.q || "", style: "flex:1" });
    var btn = el("button", { class: "btn key", type: "button" }, [A.busy ? "Asking" : "Ask"]);
    if (A.busy) btn.disabled = true;
    function run() {
      var q = input.value.trim();
      if (!q) { input.focus(); return; }
      A.q = q; A.busy = true; A.res = null; paint();
      api("ask", { method: "POST", body: { question: q } })
        .then(function (r) { A.res = r; })
        .catch(function (e) { A.res = { error: e.message || String(e), rows: [], columns: [], sql: null, explanation: "", suggestion: null, rowCount: 0 }; })
        .then(function () { A.busy = false; paint(); });
    }
    btn.onclick = run;
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } };
    body.appendChild(el("div", { class: "askin" }, [input, btn]));
    body.appendChild(el("div", { class: "small" }, ["Read only. Your question is turned into one search. Every question is kept on record."]));
    var r = A.res;
    if (A.busy) { body.appendChild(el("div", { class: "skel" }, ["Looking that up"])); return; }
    if (!r) return;
    if (r.error) {
      /* One sentence, then the machinery behind a toggle. This used to print
         the database's own complaint and the whole statement underneath it, so
         a person who asked a question in English got told about SELECT DISTINCT
         and ORDER BY. The technical text is still here for whoever wants it. */
      body.appendChild(el("div", { class: "err", role: "alert", style: "margin:0 18px 14px" }, [r.error]));
      if (r.suggestion) {
        body.appendChild(el("div", { class: "look" }, [el("b", {}, ["Try: "]), r.suggestion]));
      }
      if (r.sql || r.detail) {
        body.appendChild(el("div", { class: "look" }, [
          el("button", { class: "lnk", type: "button", onclick: function () { A.showSql = !A.showSql; paint(); } },
            [A.showSql ? "Hide what it tried" : "Show what it tried"])
        ]));
        if (A.showSql) {
          if (r.detail) body.appendChild(el("div", { class: "sqlbox" }, [r.detail]));
          if (r.sql) body.appendChild(el("div", { class: "sqlbox" }, [r.sql]));
        }
      }
      return;
    }
    /* The answer in a sentence, before the table. Somebody asked a question in
       English; a grid of columns is the evidence, not the answer. */
    if (r.insight) body.appendChild(el("div", { class: "insight" }, [r.insight]));
    body.appendChild(el("div", { class: "look" }, [
      el("b", {}, ["Looked at: "]), r.explanation || "the record", " ",
      (r.source && r.source.length)
        ? el("span", { class: "sub" }, ["From " + r.source.join(", ") + ". "]) : null,
      r.retried ? el("span", { class: "sub" }, ["First try did not run; this is the corrected one. "]) : null,
      el("button", { class: "lnk", type: "button", onclick: function () { A.showSql = !A.showSql; paint(); } }, [A.showSql ? "Hide what it ran" : "Show what it ran"])
    ]));
    if (A.showSql && r.sql) body.appendChild(el("div", { class: "sqlbox" }, [r.sql]));
    var rows = r.rows.map(function (row) { return r.columns.map(function (c) { return cell(row[c], c); }); });
    if (!rows.length) body.appendChild(el("div", { class: "empty" }, ["No rows came back."]));
    else body.appendChild(resultTable(r.columns, rows));
    /* Where to go next, as buttons rather than advice. Each one asks the box
       the question, so a person can follow a thread without typing. */
    if (r.nextQuestions && r.nextQuestions.length) {
      var more = el("div", { class: "nextq" }, [el("span", { class: "sub" }, ["Ask next"])]);
      r.nextQuestions.forEach(function (nq) {
        more.appendChild(el("button", { class: "btn small", type: "button", onclick: function () {
          var box = document.getElementById("ask-q");
          if (box) box.value = nq;
          A.q = nq; A.res = null; A.busy = true; A.showSql = false; paint();
          api("ask", { method: "POST", body: { question: nq } })
            .then(function (x) { A.res = x; })
            .catch(function (e) { A.res = { error: e.message || String(e), rows: [], columns: [], sql: null, explanation: "", suggestion: null, rowCount: 0 }; })
            .then(function () { A.busy = false; paint(); });
        } }, [nq]));
      });
      body.appendChild(more);
    }
    var note = rows.length + (rows.length === 1 ? " row" : " rows") + (r.truncated ? ", first 100 shown" : "") + " · " + (r.durationMs / 1000).toFixed(1) + "s";
    foot.appendChild(el("span", { class: "sg" }, [r.suggestion ? el("span", {}, [el("b", {}, ["Suggested: "]), r.suggestion, " "]) : null, el("span", { class: "sub" }, [note])]));
    if (rows.length) exportButtons("ask", r.columns, rows).forEach(function (b) { foot.appendChild(b); });
  }
  function paintFilter() {
    var E = ENTITIES[A.ent];
    if (!askData[A.ent]) {
      askData[A.ent] = { loading: true };
      E.load().then(function (rows) { askData[A.ent] = { rows: rows }; paint(); })
        .catch(function (e) { askData[A.ent] = { error: e.message || String(e) }; paint(); });
    }
    var data = askData[A.ent];
    var entSel = el("select", { "aria-label": "What to show", onchange: function () {
      A.ent = this.value; A.conds = [{ f: ENTITIES[A.ent].cols[0], op: "is", v: "" }]; paint();
    } }, Object.keys(ENTITIES).map(function (k) { return el("option", { value: k, selected: A.ent === k ? "" : null }, [ENTITIES[k].label]); }));
    body.appendChild(el("div", { class: "cond", style: "padding-top:14px" }, [el("span", { class: "jn" }, ["Show me"]), entSel]));
    var all = data.rows || [];
    A.conds.forEach(function (c, i) {
      var vals = [];
      var j = E.cols.indexOf(c.f);
      all.forEach(function (r) { if (j >= 0 && vals.indexOf(String(r[j])) < 0 && vals.length < 60) vals.push(String(r[j])); });
      var v = el("input", { list: "ask-dl-" + i, value: c.v, "aria-label": "Value", placeholder: "any value", style: "min-width:160px" });
      v.oninput = function () { c.v = this.value; repaintRows(); };
      body.appendChild(el("div", { class: "cond" }, [
        el("span", { class: "jn" }, [i === 0 ? "where" : "and"]),
        el("select", { "aria-label": "Field", onchange: function () { c.f = this.value; c.v = ""; paint(); } }, E.cols.map(function (f) { return el("option", { selected: c.f === f ? "" : null }, [f]); })),
        el("select", { "aria-label": "Condition", onchange: function () { c.op = this.value; repaintRows(); } }, OPS.map(function (o) { return el("option", { selected: c.op === o ? "" : null }, [o]); })),
        v,
        el("datalist", { id: "ask-dl-" + i }, vals.map(function (x) { return el("option", { value: x }); })),
        A.conds.length > 1 ? el("button", { class: "x", type: "button", "aria-label": "Remove this condition", onclick: function () { A.conds.splice(i, 1); paint(); } }, ["×"]) : null
      ]));
    });
    body.appendChild(el("div", { class: "cond" }, [el("span", { class: "jn" }), el("button", { class: "lnk", type: "button", onclick: function () { A.conds.push({ f: E.cols[0], op: "is", v: "" }); paint(); } }, ["+ Add a condition"])]));
    var rowsHost = el("div", {});
    body.appendChild(rowsHost);
    function matching() {
      return all.filter(function (r) {
        return A.conds.every(function (c) {
          if (!c.v) return true;
          var i = E.cols.indexOf(c.f); if (i < 0) return true;
          var s = String(r[i]), a = parseFloat(s.replace(/[$,]/g, "")), b = parseFloat(c.v);
          switch (c.op) {
            case "is": return s.toLowerCase() === c.v.toLowerCase();
            case "is not": return s.toLowerCase() !== c.v.toLowerCase();
            case "contains": return s.toLowerCase().indexOf(c.v.toLowerCase()) >= 0;
            case "more than": return !isNaN(a) && !isNaN(b) && a > b;
            case "less than": return !isNaN(a) && !isNaN(b) && a < b;
          }
          return true;
        });
      });
    }
    function repaintRows() {
      rowsHost.innerHTML = ""; foot.innerHTML = "";
      if (data.loading) { rowsHost.appendChild(el("div", { class: "skel" }, ["Loading " + E.label.toLowerCase()])); return; }
      if (data.error) { rowsHost.appendChild(el("div", { class: "err", role: "alert", style: "margin:0 18px 14px" }, [data.error])); return; }
      var rows = matching();
      var used = A.conds.filter(function (c) { return c.v; });
      rowsHost.appendChild(el("div", { class: "look" }, [
        el("b", {}, ["Looked at: "]), E.label.toLowerCase() + (used.length ? " where " + used.map(function (c) { return c.f.toLowerCase() + " " + c.op + " " + c.v; }).join(" and ") : ", everything") + "."
      ]));
      if (!rows.length) rowsHost.appendChild(el("div", { class: "empty" }, ["Nothing matches."]));
      else rowsHost.appendChild(resultTable(E.cols, rows));
      foot.appendChild(el("span", { class: "sg" }, [rows.length + " of " + all.length + " match."]));
      if (rows.length) exportButtons(A.ent, E.cols, rows).forEach(function (b) { foot.appendChild(b); });
    }
    repaintRows();
  }
  function paint() {
    body.innerHTML = ""; foot.innerHTML = "";
    if (A.tab === "question") paintQuestion(); else paintFilter();
    var first = body.querySelector("input");
    if (first && document.activeElement && !modal.contains(document.activeElement)) first.focus();
  }
  paintTabs();
  paint();
  var f = body.querySelector("input"); if (f) f.focus();
}

document.addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
    e.preventDefault();
    if (KEY) askDialog();
  }
});

/* --- render ------------------------------------------------------------- */

/* The main column is a scroll region, so a repaint would throw it back to
   the top. Scroll positions are taken before and put back after, but only
   while it is the same screen. */
var lastKey = null;
function render() {
  renderChrome();
  var root = document.getElementById("root");
  var key = state.view + "/" + state.arg + "/" + state.mode;
  var pos = key === lastKey ? snap(root) : null;
  root.innerHTML = "";
  if (state.error) root.appendChild(el("div", { class: "err", role: "alert" }, [state.error]));
  var view;
  if (state.view === "today") view = viewToday();
  else if (state.view === "pressing") view = viewPressing();
  else if (state.view === "tickets") view = viewTickets();
  else if (state.view === "calls") view = viewCalls();
  else if (state.view === "property") view = viewProperty();
  else if (state.view === "job") view = viewJob();
  else if (state.view === "catchup") view = viewCatchup();
  else if (state.view === "test") view = viewTest();
  else view = el("div", { class: "empty" }, ["Nothing here."]);
  /* The property register is a table of 1,327 buildings. It fills the column and
     scrolls inside itself, so the search, the filters and the pager stay put
     while the rows move. Everything else keeps the ordinary page scroll. */
  document.body.classList.toggle("tall",
    (state.view === "property" && !state.arg) || state.view === "tickets");
  [].concat(view).forEach(function (n) { if (n) root.appendChild(n); });
  if (pos) unsnap(root, pos);
  if (state.view === "test" && live.status !== "idle") {
    var convo = root.querySelector(".convo");
    if (convo) convo.scrollTop = convo.scrollHeight;
  }
  lastKey = key;
}

function boot() {
  readHash();
  state.date = todayLocal();
  Promise.all([api("technicians"), api("config"), api("queues").catch(function () { return []; })]).then(function (r) {
    state.techs = r[0]; state.config = r[1]; state.queueSummary = r[2]; load();
  }).catch(function (e) {
    if (/unauthor/i.test(e.message)) {
      /* There is no passphrase screen to fall back to any more. Clearing the
         stored key and calling boot() again just looped. */
      sessionStorage.removeItem("fd_key");
      state.error = "This link is not accepted. Check the address, or ask whoever sent it for a current one.";
      render();
      return;
    }
    fail(e);
  });
}
boot();
</script>
</body>
</html>
`;
