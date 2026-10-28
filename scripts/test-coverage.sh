#!/bin/sh
# Run both coverage suites and always write coverage/index.html.
# A non-zero status from either suite (including a missed 100% gate) is preserved.
set -u

status=0
npx vitest run --coverage || status=$?
python3 -m pytest || status=$?

mkdir -p coverage
cat > coverage/index.html <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CareOps coverage</title>
  <style>
    body { font-family: "IBM Plex Sans", sans-serif; margin: 2.5rem auto; max-width: 40rem; line-height: 1.5; color: #1c1917; }
    a { color: #9a3412; }
  </style>
</head>
<body>
  <h1>CareOps coverage</h1>
  <p>HTML reports from <code>make test</code>. The command still fails if either suite is under 100%.</p>
  <ul>
    <li><a href="ts/index.html">TypeScript and JavaScript</a> (<code>coverage/ts/</code>)</li>
    <li><a href="py/index.html">Python OCR worker</a> (<code>coverage/py/</code>)</li>
  </ul>
</body>
</html>
EOF

exit "$status"
