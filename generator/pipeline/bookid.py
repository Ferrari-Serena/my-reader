"""BYO 书的 bookId 内容指纹（Python 孪生）。

与前端 reader/src/utils/bookId.js **同一算法**：

    bookId = 'bk_' + sha256(文件原始字节) 的十六进制摘要的前 16 个字符

两侧都用真 SHA-256 的 known-answer 值自证（见各自的 self-check），
所以不会出现「JS 与 Python 各算各的」那种静默漂移。

自检：python generator/pipeline/bookid.py
"""

import hashlib

BOOK_ID_PREFIX = "bk_"
BOOK_ID_HEX_LEN = 16


def book_id_from_hex(hex_digest: str) -> str:
    """从 sha256 hex 摘要取前 16 位拼成 bookId；hex 不足 16 位返回空串。"""
    clean = "".join(c for c in str(hex_digest or "").lower() if c in "0123456789abcdef")
    if len(clean) < BOOK_ID_HEX_LEN:
        return ""
    return BOOK_ID_PREFIX + clean[:BOOK_ID_HEX_LEN]


def is_book_id(value) -> bool:
    """形状判据：只有 BYO 书的 id 长这样。"""
    if not isinstance(value, str):
        return False
    if not value.startswith(BOOK_ID_PREFIX):
        return False
    tail = value[len(BOOK_ID_PREFIX):]
    return len(tail) == BOOK_ID_HEX_LEN and all(c in "0123456789abcdef" for c in tail)


def book_id_from_bytes(data: bytes) -> str:
    """原始字节 -> bookId。"""
    return book_id_from_hex(hashlib.sha256(bytes(data)).hexdigest())


def book_id_from_text(text: str) -> str:
    """文本 -> bookId（按 UTF-8 编码后取指纹）。"""
    return book_id_from_bytes(str(text).encode("utf-8"))


if __name__ == "__main__":
    # known-answer：与前端 verify-core.mjs 用的是同一组真 SHA-256 值
    assert book_id_from_bytes(b"") == "bk_e3b0c44298fc1c14", book_id_from_bytes(b"")
    assert book_id_from_bytes(b"abc") == "bk_ba7816bf8f01cfea", book_id_from_bytes(b"abc")
    assert book_id_from_text("abc") == "bk_ba7816bf8f01cfea"
    assert book_id_from_hex("ba7816bf8f01cfea4141") == "bk_ba7816bf8f01cfea"
    assert book_id_from_hex("abc") == ""
    assert is_book_id("bk_ba7816bf8f01cfea") is True
    assert is_book_id("the-giver") is False
    assert book_id_from_bytes(b"x") != book_id_from_bytes(b"y")
    print("bookid.py self-check ok")
