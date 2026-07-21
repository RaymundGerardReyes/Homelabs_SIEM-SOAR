import asyncio
from collections import deque
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

class AgentEventBus:
    def __init__(self, max_history=500):
        self.history = deque(maxlen=max_history)
        self.subscribers = []

    def emit(self, event: Dict[str, Any]):
        self.history.append(event)
        for queue in self.subscribers:
            try:
                # If queue is full (slow client), we drop the oldest
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait(event)
            except Exception as e:
                logger.error(f"Failed to broadcast event to a subscriber: {e}")

    def subscribe(self) -> asyncio.Queue:
        queue = asyncio.Queue(maxsize=100)
        self.subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        if queue in self.subscribers:
            self.subscribers.remove(queue)

    def get_history(self) -> List[Dict[str, Any]]:
        return list(self.history)

agent_event_bus = AgentEventBus()
