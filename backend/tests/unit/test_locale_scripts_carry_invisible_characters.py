"""The locale scripts under ``scripts/`` must be transparent to invisible characters.

Zero-width characters are invisible by construction, so every way of mishandling
them looks correct on screen. Some of those ways were live in this repository at
once, and none of them showed up in a diff, a review or a gate:

* ``scripts/i18n_extract.py`` decoded each value with the ``unicode_escape``
  codec, which reads a string's UTF-8 bytes back as latin-1. A zero-width
  character came out as three characters, and so did every Cyrillic, CJK and
  Arabic letter in the file.
* ``scripts/translate_mn_pass2.py`` and ``scripts/translate_mn_pass6_more_long.py``
  hold translation tables whose keys are English source strings. Some of those
  keys picked up a run of invisible characters from a mechanical pass over the
  tree. A key holding one cannot match the English string it is meant to match,
  so those entries were dead, and the scripts reported success while translating
  nothing.
* ``scripts/i18n_apply.py``, read the
  locale with ``Path.read_text`` and wrote it back with ``Path.write_text``.
  Both translate line endings, so a run that replaced nothing still rewrote the
  whole file - to CRLF on Windows, to LF everywhere else.

The assertions below compare code points and bytes, never rendered strings. A
rendered comparison is what let all three through.
"""

from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = _REPO_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import i18n_apply  # noqa: E402
import i18n_extract  # noqa: E402

# Written as escapes on purpose. A test that spells invisible characters out
# literally cannot be reviewed, which is the whole problem it exists to catch.
ZERO_WIDTH_RUN = "\u200c\u2060\u200d"

# Every script that rewrites frontend/src/app/locales/mn.ts in place.
MN_PASSES = (
    "translate_mn_pass2.py",
    "translate_mn_pass3.py",
    "translate_mn_pass5_long.py",
    "translate_mn_pass6_more_long.py",
    "translate_mn_pass7_fixes.py",
    "translate_mn_pass8_final.py",
    "translate_mn_pass9.py",
)


def _invisible(text: str) -> bool:
    return any(unicodedata.category(ch) == "Cf" for ch in text)


def _printing(text: str) -> str:
    return "".join(ch for ch in text if unicodedata.category(ch) != "Cf")


# ── scripts/i18n_extract.py ──────────────────────────────────────────────────


def test_the_fallbacks_parser_returns_every_code_point_it_read() -> None:
    """A parsed value must equal the source value code point for code point."""
    marked = "Save" + ZERO_WIDTH_RUN
    cyrillic = "Сохранить"
    source = (
        "export const fallbackResources = {\n"
        "  en: {\n"
        "    translation: {\n"
        f"      'action.save': '{marked}',\n"
        "    },\n"
        "  },\n"
        "  ru: {\n"
        "    translation: {\n"
        f"      'action.save': '{cyrillic}',\n"
        "    },\n"
        "  },\n"
        "};\n"
    )

    blocks = i18n_extract.parse_blocks(source)

    assert list(blocks) == ["en", "ru"]
    parsed = blocks["en"]["action.save"]
    assert [ord(ch) for ch in parsed] == [ord(ch) for ch in marked]
    assert parsed.encode("utf-8") == marked.encode("utf-8")
    # The same defect destroyed everything above U+007F, not only the invisibles.
    assert blocks["ru"]["action.save"].encode("utf-8") == cyrillic.encode("utf-8")


def test_the_fallbacks_parser_still_decodes_the_escapes_it_is_meant_to() -> None:
    """Transparency to literal characters must not turn the unescaper off."""
    source = (
        "export const fallbackResources = {\n"
        "  en: {\n"
        "    translation: {\n"
        "      'a.quote': 'It\\'s here',\n"
        "      'a.tab': 'left\\tright',\n"
        "      'a.escaped': 'zero\\u200bwidth',\n"
        "    },\n"
        "  },\n"
        "};\n"
    )

    parsed = i18n_extract.parse_blocks(source)["en"]

    assert parsed["a.quote"] == "It's here"
    assert parsed["a.tab"] == "left\tright"
    assert parsed["a.escaped"] == "zero\u200bwidth"


# ── scripts/i18n_apply.py ────────────────────────────────────────────────────

# Mixed endings again, and a blank line right after the entry that gets
# replaced: the old pattern ended in ``,?\s*$``, which is greedy and matches
# before any newline, so it swallowed the entry's own ending and the blank line
# with it. The value that carries the marks is on a line the patch does not
# touch, so the same fixture shows that an untouched line comes back verbatim.
_FALLBACKS_FIXTURE = (
    "export const fallbackResources = {\n"
    "  en: {\n"
    "    translation: {\n"
    f"      'action.save': 'Save{ZERO_WIDTH_RUN}',\r\n"
    "      'action.close': 'Close',\r\n"
    "\n"
    "      'action.open': 'Open',\n"
    "    },\n"
    "  },\n"
    "};\n"
)


def test_the_fallbacks_writer_changes_only_the_value_it_was_asked_to_change() -> None:
    """Replacing one value must leave every other byte of the file alone."""
    updated = i18n_apply._replace_or_append(_FALLBACKS_FIXTURE, "en", {"action.close": "Zavrit"}, {})

    assert updated == _FALLBACKS_FIXTURE.replace("'action.close': 'Close',", "'action.close': 'Zavrit',")


def test_the_fallbacks_writer_appends_with_the_ending_the_block_already_uses() -> None:
    """A new entry gets the block's own line ending, and the marks stay put."""
    updated = i18n_apply._replace_or_append(_FALLBACKS_FIXTURE, "en", {"action.new": "Nove"}, {})

    assert "      'action.new': 'Nove',\r\n" in updated
    assert f"      'action.save': 'Save{ZERO_WIDTH_RUN}',\r\n" in updated
