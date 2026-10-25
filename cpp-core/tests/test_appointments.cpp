#include "AppointmentService.h"
#include <iostream>
#include <vector>
#include <string>

using namespace ClinicQueue;

int main() {
    std::vector<std::string> booked = {"09:40", "10:20"};
    std::vector<int> workingDays = {1, 2, 3, 4, 5, 6};

    // Assume 2026-10-15 is Thursday (Day 4)
    auto slots = AppointmentService::generateAvailableSlots(
        "09:00", "11:00",
        "13:00", "14:00",
        20,
        booked,
        "2026-10-15",
        "2026-10-14T00:00:00Z", // yesterday, so no slots are "past"
        workingDays
    );

    // Expected: 09:00, 09:20, 10:00, 10:40
    // Total 4 slots
    if (slots.size() != 4) {
        std::cerr << "Expected 4 slots, got " << slots.size() << "\n";
        for (auto s: slots) std::cerr << s << "\n";
        return 1;
    }

    if (slots[0] != "09:00" || slots[1] != "09:20" || slots[2] != "10:00" || slots[3] != "10:40") {
        std::cerr << "Slots did not match expected values.\n";
        return 1;
    }

    std::cout << "Appointment slot logic passed.\n";
    return 0;
}
