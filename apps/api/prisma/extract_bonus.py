"""
从《校教〔2026〕39 号》通知 PDF 中提取"学科竞赛"认定清单与加分标准，
输出 JSON 供 prisma/seed.ts 使用。

用法（在仓库根目录运行）：
    python apps/api/prisma/extract_bonus.py > apps/api/prisma/bonus-list.json
"""
import json
import os
import re
import sys

import fitz  # PyMuPDF

PDF_PATH = os.path.join(
    "data",
    "校教〔2026〕39号_关于开展推荐2027届优秀应届本科毕业生免试攻读研究生工作的通知.pdf",
)

# 加分标准（通知第 7 页"1.竞赛获奖（1）学科竞赛"表格）
BONUS_STANDARD = {
    "category": "学科竞赛",
    "national": {"top": "3", "second": "2.5", "third": "1.5"},
    "provincial": {"top": "1", "second": "0.3", "third": "0.1"},
}

STOP_MARK = "（2）文体竞赛"


def extract():
    doc = fitz.open(PDF_PATH)
    lines = []
    for i in range(len(doc)):
        lines.extend(ln.strip() for ln in doc[i].get_text().splitlines())

    # 定位清单起点：学科竞赛小节中"项目列表"标记之后
    start = 0
    for idx, ln in enumerate(lines):
        if "（1）学科竞赛" in ln:
            for j in range(idx, len(lines)):
                if lines[j] == "项目列表":
                    start = j + 1
                    break
            break
    # 定位终点：文体竞赛小节
    end = len(lines)
    for j in range(start, len(lines)):
        if STOP_MARK in lines[j]:
            end = j
            break

    seq = [ln for ln in lines[start:end] if not re.fullmatch(r"—\d+—", ln)]
    items = {}
    expect = 1
    i = 0
    while i < len(seq):
        if re.fullmatch(r"\d{1,2}", seq[i]) and int(seq[i]) == expect:
            name_parts = []
            j = i + 1
            while j < len(seq) and not re.fullmatch(r"\d{1,2}", seq[j]):
                name_parts.append(seq[j])
                j += 1
            if name_parts:
                items[expect] = "".join(name_parts)
                expect += 1
                i = j
                continue
        i += 1

    return [items[k] for k in sorted(items)]


if __name__ == "__main__":
    names = extract()
    json.dump({"standard": BONUS_STANDARD, "competitions": names}, sys.stdout, ensure_ascii=False, indent=2)
    print("\n# 共提取 %d 项学科竞赛" % len(names), file=sys.stderr)
