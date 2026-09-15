"""三轮质量与归档汇总入口；实现位于 quality.py。"""
import argparse
from quality import summarize

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='store_true')
    summarize(parser.parse_args().archive)
