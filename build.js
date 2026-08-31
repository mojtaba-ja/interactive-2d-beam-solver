'use strict';
/* =====================================================================
   build.js - bundles the site into single self-contained files.

     node build.js

   Produces
     dist/Interactive-2D-Beam-Solver.html   one file, works offline by
                                            double-clicking it; this is the
                                            copy to hand to someone else
     dist/artifact.html                     the same page without the
                                            <!doctype>/<html>/<head>/<body>
                                            wrapper, for hosts that supply
                                            their own document shell
   ===================================================================== */

var fs = require('fs');
var path = require('path');

var root = __dirname;
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function readAsset(rel) {
  return fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8');
}

/* A </script> or </style> inside the payload would close the tag early.
   Nothing in this project contains one, but guard anyway.               */
function safe(code) {
  return code.replace(/<\/(script|style)/gi, '<\\/$1');
}

/* ---- inline the stylesheet ---- */
var out = html.replace(
  /<link rel="stylesheet" href="([^"]+)">/,
  function (m, href) { return '<style>\n' + safe(readAsset(href)) + '\n</style>'; }
);

/* ---- inline every local script, in order ---- */
out = out.replace(
  /<script src="([^"]+)"><\/script>/g,
  function (m, src) { return '<script>\n' + safe(readAsset(src)) + '\n</script>'; }
);

if (out.indexOf('<link rel="stylesheet"') >= 0 || /<script src="/.test(out)) {
  console.error('build: something was not inlined - check index.html');
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

var standalone = path.join(root, 'dist', 'Interactive-2D-Beam-Solver.html');
fs.writeFileSync(standalone, out, 'utf8');

/* ---- body-only variant for hosts that provide the document shell ---- */
var body = out;
var t = body.match(/<title>([\s\S]*?)<\/title>/i);
var styleBlocks = body.match(/<style>[\s\S]*?<\/style>/gi) || [];
var bodyInner = body.match(/<body>([\s\S]*)<\/body>/i);
if (!bodyInner) {
  console.error('build: could not find the <body> of index.html');
  process.exit(1);
}
var artifact =
  '<title>' + (t ? t[1] : 'Interactive 2D Beam Solver') + '</title>\n' +
  styleBlocks.join('\n') + '\n' +
  '<script>window.__ARTIFACT__ = true;</script>\n' +
  bodyInner[1].trim() + '\n';

fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), artifact, 'utf8');

function kb(p) { return (fs.statSync(p).size / 1024).toFixed(0) + ' KB'; }
console.log('dist/Interactive-2D-Beam-Solver.html  ' + kb(standalone));
console.log('dist/artifact.html                    ' + kb(path.join(root, 'dist', 'artifact.html')));
