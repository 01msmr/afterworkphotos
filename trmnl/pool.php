<?php
// Lay down the TRMNL pools: a directory of symlinks per day, days ahead.
//
// Each day gets img/trmnl/YYYY-MM-DD/, holding links to the photographs the
// panel may show that day. trmnl/photo.php draws one out of today's. Nothing is
// rendered and nothing is copied — the links point two levels up, at the plain
// 1200 px files the site already serves. img/trmnl/ is gitignored, so the Git
// deployment never sees it.
//
// The pool is the last 30 days plus the same day in any year, give or take a
// day. Where that leaves fewer than four, the window widens a day at a time
// until it does not — the collection is thin in recent years and the plain rule
// runs empty on 77 days of the year.
//
// PHP rather than Python because the host's scheduled tasks run in a chroot
// holding /bin and /usr/bin only, and there is no Python in it.
//
//   php trmnl/pool.php --days 40
//   php trmnl/pool.php --days 7 --date 2026-07-01 --pool /tmp/try
//   php trmnl/pool.php --selftest

// it lives in the webroot, so make sure the web cannot set it running
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("cli only\n");
}

const RECENT_DAYS = 30;   // how far back "lately" reaches
const WINDOW = 1;         // the same day in any year, give or take this many
const WANT = 4;           // widen the window until at least this many qualify
const WINDOW_MAX = 30;    // and no further
const DAYS = 40;          // how far ahead to lay pools down
const KEEP_BACK = 3;      // and how many past days to leave standing

$ROOT = dirname(__DIR__);
$PHOTOS = $ROOT . '/photos.json';
$IMG = $ROOT . '/img';
$POOL = $IMG . '/trmnl';


// A date as a whole number of days, fixed at noon UTC so daylight saving and
// the host's timezone cannot shift it across a boundary.
function dayNum(string $ymd): int
{
    return intdiv(strtotime($ymd . ' 12:00:00 UTC'), 86400);
}


function load(string $path): array
{
    $json = json_decode(file_get_contents($path), true);
    $out = [];
    foreach ($json['photos'] as $p) {
        $out[] = [substr($p['taken'], 0, 10), $p];
    }
    return $out;
}


// The photographs in range on $day, newest first.
function poolFor(array $taken, string $day, int $window): array
{
    $dayNum = dayNum($day);
    $md = [];
    for ($k = -$window; $k <= $window; $k++) {
        $md[gmdate('m-d', ($dayNum + $k) * 86400)] = true;
    }

    $picked = [];
    foreach ($taken as [$d, $p]) {
        $back = $dayNum - dayNum($d);
        if ($back >= 0 && $back <= RECENT_DAYS) {
            $picked[$p['n']] = $p;
        } elseif (isset($md[substr($d, 5)])) {
            $picked[$p['n']] = $p;
        }
    }
    krsort($picked, SORT_NUMERIC);
    return array_values($picked);
}


// Grow the window until the pool holds WANT, or WINDOW_MAX gives up.
function widen(array $taken, string $day): array
{
    $got = [];
    $w = WINDOW;
    for ($w = WINDOW; $w <= WINDOW_MAX; $w++) {
        $got = poolFor($taken, $day, $w);
        if (count($got) >= WANT) {
            break;
        }
    }
    return [$got, min($w, WINDOW_MAX)];
}


// Every entry a symlink — the guard before anything is removed.
function linksOnly(string $dir): void
{
    foreach (array_diff(scandir($dir), ['.', '..']) as $e) {
        if (!is_link($dir . '/' . $e)) {
            fwrite(STDERR, "$dir/$e is not a symlink — refusing to touch $dir\n");
            exit(1);
        }
    }
}


// Where $target lies as seen from the directory $from. Both absolute.
function relpath(string $target, string $from): string
{
    $t = explode('/', trim($target, '/'));
    $f = explode('/', trim($from, '/'));
    while ($t && $f && $t[0] === $f[0]) {
        array_shift($t);
        array_shift($f);
    }
    return rtrim(str_repeat('../', count($f)) . implode('/', $t), '/');
}


// Replace the day's links with one per photograph.
function relink(string $dir, array $photos, string $img): void
{
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    linksOnly($dir);
    foreach (array_diff(scandir($dir), ['.', '..']) as $e) {
        unlink($dir . '/' . $e);
    }
    $up = relpath(realpath($img), realpath($dir));
    foreach ($photos as $p) {
        $name = basename($p['file']);
        if (!file_exists($img . '/' . $name)) {
            fwrite(STDERR, "  " . basename($dir) . ": skipped {$p['n']}, $name is missing\n");
            continue;
        }
        symlink($up . '/' . $name, $dir . '/' . $name);
    }
}


// Drop the day directories now behind us.
function prune(string $root, string $before): int
{
    $gone = 0;
    foreach (glob($root . '/20??-??-??', GLOB_ONLYDIR) ?: [] as $d) {
        if (dayNum(basename($d)) < dayNum($before)) {
            linksOnly($d);
            array_map('unlink', glob($d . '/*') ?: []);
            rmdir($d);
            $gone++;
        }
    }
    return $gone;
}


// The rule's promises, over a year: never short, never empty, never stuck.
function selftest(array $taken): int
{
    $first = dayNum(date('Y') . '-01-01');
    $sizes = [];
    $windows = [];
    for ($i = 0; $i < 365; $i++) {
        $day = gmdate('Y-m-d', ($first + $i) * 86400);
        [$got, $w] = widen($taken, $day);
        if (count($got) < WANT) {
            fwrite(STDERR, "$day: only " . count($got) . " photos at window $w\n");
            return 1;
        }
        $sizes[] = count($got);
        $windows[] = $w;
    }
    sort($sizes);
    $atWindow = count(array_keys($windows, WINDOW, true));
    printf("365 days checked: pool %d-%d, median %d\n", min($sizes), max($sizes), $sizes[182]);
    printf("window stayed at %d on %d days, worst %d\n", WINDOW, $atWindow, max($windows));
    return 0;
}


// ---- command line ----------------------------------------------------------

$opts = getopt('', ['days:', 'date:', 'pool:', 'selftest']);
$taken = load($PHOTOS);

if (isset($opts['selftest'])) {
    exit(selftest($taken));
}

$days = isset($opts['days']) ? (int) $opts['days'] : DAYS;
$start = $opts['date'] ?? date('Y-m-d');
$pool = $opts['pool'] ?? $POOL;

if (!is_dir($pool)) {
    mkdir($pool, 0755, true);
}

$startNum = dayNum($start);
$total = 0;
for ($i = 0; $i < $days; $i++) {
    $day = gmdate('Y-m-d', ($startNum + $i) * 86400);
    [$photos, $w] = widen($taken, $day);
    relink($pool . '/' . $day, $photos, $IMG);
    $total += count($photos);
    if ($i < 3) {
        $ns = array_map(fn($p) => $p['n'], array_slice($photos, 0, 6));
        printf("  %s  ±%d  %2d photos  %s\n", $day, $w, count($photos), implode(', ', $ns));
    }
}
$dropped = prune($pool, gmdate('Y-m-d', ($startNum - KEEP_BACK) * 86400));
printf("%s: %d days laid down, %d links, %d old days dropped\n", $pool, $days, $total, $dropped);
