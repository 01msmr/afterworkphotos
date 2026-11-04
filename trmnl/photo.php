<?php
// One photograph for the TRMNL panel. The address is fixed; the picture is not.
//
// trmnl/pool.php lays down a directory of symlinks per day under img/trmnl/,
// weeks ahead. This reads today's, draws one name, and writes the file out.
//
// It serves the bytes rather than redirecting to them. A 302 works in TRMNL's
// markup editor, whose preview your own browser fetches, but the device screen
// is rendered on TRMNL's servers and their image fetcher does not follow it —
// the panel showed a missing-image placeholder while the preview looked right.
//
// The draw is a shuffled bag, not a coin toss. A pool holds four or five
// pictures, so a fair choice would land on the one already showing about a
// fifth of the time, and a repeat on e-paper reads as a failed refresh. Every
// picture is shown once before any is shown again, in a fresh order each pass.
//
// Documented in docs/trmnl.md.

$IMG = dirname(__DIR__) . '/img';
$POOLS = $IMG . '/trmnl';             // one directory per day
$BAG = $POOLS . '/.bag.json';         // what is left of the current pass

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');

$pool = todaysPool($POOLS);
$names = $pool ? array_values(array_diff(scandir($pool), ['.', '..'])) : [];
if (!$names) {
    http_response_code(503);
    exit("no pool\n");
}
sort($names);

$pick = basename(draw($names, $BAG));
$file = $IMG . '/' . $pick;
if (!is_file($file)) {
    http_response_code(503);
    exit("missing $pick\n");
}

header('Content-Type: image/jpeg');
header('Content-Length: ' . filesize($file));
header('X-Awp-Photo: ' . $pick);   // a HEAD says which one without pulling it
readfile($file);


// Today's pool directory. If there is none — the scheduled task lapsed, or the
// clock sits either side of a day boundary — the nearest day stands in. Never
// the newest: that would show December's photographs in May.
function todaysPool(string $pools): ?string
{
    $today = $pools . '/' . date('Y-m-d');
    if (is_dir($today)) {
        return $today;
    }

    $now = strtotime(date('Y-m-d'));
    $nearest = null;
    $gap = null;
    foreach (glob($pools . '/20??-??-??', GLOB_ONLYDIR) ?: [] as $d) {
        $g = abs(strtotime(basename($d)) - $now);
        if ($gap === null || $g < $gap) {
            $gap = $g;
            $nearest = $d;
        }
    }
    return $nearest;
}


// Take the next picture from the bag, refilling it when the pass is done or the
// pool has changed. Falls back to a plain random pick if the bag is unwritable.
function draw(array $names, string $path): string
{
    $fh = @fopen($path, 'c+');
    if (!$fh) {
        return $names[random_int(0, count($names) - 1)];
    }
    flock($fh, LOCK_EX);

    $bag = json_decode(stream_get_contents($fh), true);
    $bag = is_array($bag) ? $bag : [];
    $key = implode(',', $names);          // a changed pool opens a new bag
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
