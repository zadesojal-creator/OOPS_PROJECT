#pragma once
#include <string>
#include <vector>

namespace ClinicQueue {

/*
 * AppointmentService
 * Replaces the Qt-dependent static method. Uses standard C++17 <chrono> and
 * <ctime> for time math instead of QDate/QTime.
 */
class AppointmentService {
public:
    // Generates a list of available "HH:MM" slots based on the doctor's schedule,
    // working days, lunch break, and existing bookings.
    static std::vector<std::string> generateAvailableSlots(
        const std::string& startTimeStr,   // "09:00"
        const std::string& endTimeStr,     // "17:00"
        const std::string& lunchStartStr,  // "13:00"
        const std::string& lunchEndStr,    // "14:00"
        int slotDurationMinutes,
        const std::vector<std::string>& bookedSlots,
        const std::string& targetDate,     // "YYYY-MM-DD"
        const std::string& nowUtc,         // "YYYY-MM-DDTHH:MM:SSZ" (to filter past slots)
        const std::vector<int>& workingDays // ISO day-of-week: 1=Mon .. 7=Sun
    );
};

} // namespace ClinicQueue
