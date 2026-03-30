import logging

PREFIX = "[context-graph]"


def create_logger(debug: bool = False) -> logging.Logger:
    logger = logging.getLogger("graphmind_context_graphs")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(f"{PREFIX} %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    return logger
