#include "QueueManager.h"
#include <iostream>

using namespace ClinicQueue;

int main() {
    std::vector<QueueToken> tokens = {
        QueueToken("id1", "1", "p1", "Alice", Priority::Normal, TokenStatus::Waiting, "2026-10-15T10:05:00Z"),
        QueueToken("id2", "2", "p2", "Bob", Priority::Emergency, TokenStatus::Waiting, "2026-10-15T10:10:00Z"),
        QueueToken("id3", "3", "p3", "Charlie", Priority::Senior, TokenStatus::Waiting, "2026-10-15T10:08:00Z"),
        QueueToken("id4", "4", "p4", "Dave", Priority::Emergency, TokenStatus::Waiting, "2026-10-15T10:00:00Z")
    };

    auto ordered = QueueManager::orderTokens(tokens);

    // Expected order:
    // 1. Dave (Emergency, earlier)
    // 2. Bob (Emergency, later)
    // 3. Charlie (Senior)
    // 4. Alice (Normal)
    if (ordered.size() != 4) return 1;
    if (ordered[0].id() != "id4") return 1;
    if (ordered[1].id() != "id2") return 1;
    if (ordered[2].id() != "id3") return 1;
    if (ordered[3].id() != "id1") return 1;

    std::cout << "Queue sorting logic passed.\n";
    return 0;
}
