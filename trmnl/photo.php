<?php
// One photograph out of today's pool, for the TRMNL panel.
//
// The pool directories under img/trmnl/ are laid down weeks ahead by
// scripts/trmnl.py and hold nothing but symlinks. This only reads the names and
// redirects to the real file, so the webserver never has to follow a symlink.
// The address is fixed; the picture is not.
//
// The pick is a shuffled bag, not a coin toss. A pool holds four or five
// pictures, so a fair choice would land on the one already showing about a
// fifth of the time, and a repeat on e-paper reads as a failed refresh. Every
// picture is shown once before any is shown again, in a fresh order each pass.

$POOLS = __DIR__ . '/../img/trmnl';   // where the day directories live
$BAG = $POOLS . '/.bag.json';         // what is left of the current pass

$today = date('Y-m-d');
$pool = $POOLS . '/' . $today;

// no pool for today — the task lapsed, or the clock sits across a day boundary.
// Fall back to the nearest day, never the newest: that shows December in May.
if (!is_dir($pool)) {
    $now = strtotime($today);
    $pool = null;
    $gap = null;
    foreach (glob($POOLS . '/20??-??-??', GLOB_ONLYDIR) ?: [] as $d) {
        $g = abs(strtotime(basename($d)) - $now);
        if ($gap === null || $g < $gap) {
            $gap = $g;
            $pool = $d;
        }
    }
}

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$names = $pool ? array_values(array_diff(scandir($pool), ['.', '..'])) : [];
if (!$names) {
    http_response_code(503);
    exit("no pool\n");
}
sort($names);

// Serve the bytes rather than redirecting: TRMNL renders server side, and an
// image fetcher cannot be relied on to follow a Location header.
$pick = basename(draw($names, $BAG));
$file = dirname(__DIR__) . '/img/' . $pick;
if (!is_file($file)) {
    http_response_code(503);
    exit("missing $pick\n");
}
header('Content-Type: image/jpeg');
header('Content-Length: ' . filesize($file));
header('X-Awp-Photo: ' . $pick);   // which one, without fetching the picture
readfile($file);


// Take the next picture from the bag, refilling it when the pass is done or the
// pool has changed. Falls back to a plain random pick if the bag is unwritable.
function draw(array $names, string $path)
{
    $fh = @fopen($path, 'c+');
    if (!$fh) {
        return $names[random_int(0, count($names) - 1)];
    }
    flock($fh, LOCK_EX);

    $bag = json_decode(stream_get_contents($fh), true);
    $bag = is_array($bag) ? $bag : [];
    $key = implode(',', $names);          // a new pool opens a new bag
    $last = $bag['last'] ?? null;

    if (($bag['key'] ?? null) !== $key || empty($bag['left'])) {
        $left = $names;
        shuffle($left);
        // don't open the new pass with the picture the last one ended on
        if (count($left) > 1 && $left[0] === $last) {
            $left[] = array_shift($left);
        }
        $bag = ['key' => $key, 'left' => $left];
    }

    $pick = array_shift($bag['left']);
    $bag['last'] = $pick;

    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($bag));
    flock($fh, LOCK_UN);
    fclose($fh);
    return $pick;
}
