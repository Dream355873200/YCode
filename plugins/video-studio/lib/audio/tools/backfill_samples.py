"""backfill_samples.py -- 补齐 lib/audio/samples 缺失的 VCSL 采样。

index.json 登记 42 个乐器键，仓库只自带 16 个精选目录（部分键还不全）。
本脚本按 index 登记的文件名到 VCSL（CC0，github sgossner/VCSL）匹配原始文件，
并行下载到 /tmp/vcsl_raw/<key>/，再调 build_samples.py 重建（裁剪/48k/flac），
最后把新旧 index 合并。用法：python backfill_samples.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.normpath(os.path.join(HERE, '..', 'samples'))
RAW = os.path.join(os.environ.get('TEMP', '/tmp'), 'vcsl_raw')
TREE_CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'vcsl_tree.json')
API_TREE = 'https://api.github.com/repos/sgossner/VCSL/git/trees/master?recursive=1'
REPO_RAW = 'https://raw.githubusercontent.com/sgossner/VCSL/master/'
WORKERS = 8


def sanitize(fn: str) -> str:
    stem = os.path.splitext(fn)[0]
    return re.sub(r'[^A-Za-z0-9_#\-]+', '_', stem) + '.flac'


def fetch_tree() -> dict:
    if os.path.exists(TREE_CACHE):
        return json.load(open(TREE_CACHE, encoding='utf-8'))
    req = urllib.request.Request(API_TREE, headers={'User-Agent': 'samples-backfill'})
    tree = json.load(urllib.request.urlopen(req, timeout=60))
    json.dump(tree, open(TREE_CACHE, 'w', encoding='utf-8'))
    return tree


def main() -> int:
    idx = json.load(open(os.path.join(SAMPLES, 'index.json'), encoding='utf-8'))
    tree = fetch_tree()
    by_stem = {}
    for b in tree.get('tree', []):
        if b['type'] == 'blob' and b['path'].lower().endswith(('.wav', '.mp3', '.flac')):
            base = os.path.basename(b['path'])
            stem = os.path.splitext(base)[0].lower()
            # 非 Legacy 路径优先（同名旧版排后）
            by_stem.setdefault(stem, []).append(b['path'])

    tasks = []  # (key, raw_url, raw_name)
    miss_entries = 0
    for key, entries in idx.items():
        for e in entries:
            final = os.path.basename(e['file'])
            if os.path.exists(os.path.join(SAMPLES, final.replace('/', os.sep)) if False else os.path.join(SAMPLES, key, final)):
                continue
            stem = os.path.splitext(final)[0].lower()
            cands = by_stem.get(stem) or by_stem.get(stem.replace('_', '').lower())
            if not cands:
                print(f'  ? 树中找不到 {key}/{final}')
                miss_entries += 1
                continue
            cands = sorted(cands, key=lambda p: ('Legacy' in p, len(p)))
            raw_name = os.path.basename(cands[0])
            url = REPO_RAW + urllib.parse.quote(cands[0])
            tasks.append((key, url, raw_name))

    if not tasks:
        print('没有需要补的文件'); return 0
    print(f'待下载 {len(tasks)} 个 raw 文件（{WORKERS} 并发）…找不到匹配的登记项 {miss_entries} 个')

    def dl(job):
        key, url, raw_name = job
        d = os.path.join(RAW, key)
        os.makedirs(d, exist_ok=True)
        dst = os.path.join(d, raw_name)
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            return True
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'samples-backfill'})
                with urllib.request.urlopen(req, timeout=180) as r, open(dst + '.part', 'wb') as f:
                    shutil.copyfileobj(r, f)
                os.replace(dst + '.part', dst)
                return True
            except Exception:
                if attempt == 2:
                    try: os.remove(dst + '.part')
                    except OSError: pass
                    return False
        return False

    ok = fail = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        for i, r in enumerate(ex.map(dl, tasks)):
            ok += r; fail += not r
            if (i + 1) % 25 == 0 or i + 1 == len(tasks):
                print(f'  {i + 1}/{len(tasks)}（成功 {ok} 失败 {fail}）')
    if fail:
        print(f'{fail} 个下载失败——重跑本脚本会续传')

    print('调用 build_samples.py 重建（裁剪/48k/flac/重建 index）…')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'build_samples.py'), RAW])
    if r.returncode != 0:
        print('build_samples 失败'); return 1

    # build_samples 重建的 index 只含本次处理的键——与旧 index 合并（磁盘上不存在的旧条目丢弃）
    new_idx = json.load(open(os.path.join(SAMPLES, 'index.json'), encoding='utf-8'))
    # 按条目合并：build_samples 的 index 只含本次处理的文件，旧文件条目必须保留
    merged = {}
    for src in (idx, new_idx):
        for key, entries in src.items():
            got = merged.setdefault(key, [])
            have = {e['file'] for e in got}
            for e in entries:
                if e['file'] not in have and os.path.exists(os.path.join(SAMPLES, e['file'].replace('/', os.sep))):
                    got.append(e); have.add(e['file'])
    json.dump(merged, open(os.path.join(SAMPLES, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    total = sum(len(v) for v in merged.values())
    print(f'完成：{len(merged)} 键 / {total} 条目')
    return 0


if __name__ == '__main__':
    sys.exit(main())
