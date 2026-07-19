from pydantic import BaseModel
from typing import List, Dict

class Playbook(BaseModel):
    id: str
    name: str
    trigger: str
    code: str

PLAYBOOKS_DB: Dict[str, Playbook] = {
    "pb-1": Playbook(
        id="pb-1",
        name="Auto-Isolate Malware",
        trigger="Malware_Detected",
        code=(
            "import sys\n\n"
            "def run(target):\n"
            "    return f'[SUCCESS] Host {target} processed successfully in sandbox.'\n\n"
            "if __name__ == '__main__':\n"
            "    print(run(sys.argv[1]))\n"
        )
    ),
    "pb-2": Playbook(
        id="pb-2",
        name="Block Malicious IP",
        trigger="C2_Beacon_Detected",
        code=(
            "import sys\n\n"
            "def run(target):\n"
            "    return f'[SUCCESS] IP {target} added to block-list.'\n\n"
            "if __name__ == '__main__':\n"
            "    print(run(sys.argv[1]))\n"
        )
    ),
}

def get_all_playbooks() -> List[Playbook]:
    return list(PLAYBOOKS_DB.values())
