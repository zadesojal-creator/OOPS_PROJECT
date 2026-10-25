#include "QueueManager.h"
#include <algorithm>

namespace ClinicQueue {

std::vector<QueueToken> QueueManager::orderTokens(std::vector<QueueToken> tokens) {
    std::stable_sort(tokens.begin(), tokens.end(),
        [](const QueueToken& left, const QueueToken& right) {
            // Priority ordering: EMERGENCY (0) < SENIOR (1) < NORMAL (2)
            int leftRank = priorityRank(left.priority());
            int rightRank = priorityRank(right.priority());
            
            if (leftRank != rightRank) {
                return leftRank < rightRank;
            }
            
            // If priorities match, sort by createdAt (ISO string, so lex sort is safe)
            return left.createdAt() < right.createdAt();
        }
    );
    return tokens;
}

} // namespace ClinicQueue
