#pragma once
#include "QueueToken.h"
#include <vector>
#include <memory>

namespace ClinicQueue {

/*
 * QueueManager
 * Handles the logic for sorting and selecting the next patient from the queue.
 * Replaces the old QueueService static methods, applying pure C++17 sorting.
 */
class QueueManager {
public:
    // Sorts a list of tokens based on priority (Emergency > Senior > Normal)
    // and then by createdAt (FIFO) if priorities match.
    // We pass by value to sort a copy, or the caller can std::move into it.
    static std::vector<QueueToken> orderTokens(std::vector<QueueToken> tokens);
};

} // namespace ClinicQueue
