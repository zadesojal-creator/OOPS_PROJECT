#include "AppointmentService.h"
#include <iomanip>
#include <sstream>
#include <ctime>

namespace ClinicQueue {

namespace {
    // Helper to parse "HH:MM" into minutes since midnight
    int parseTimeStr(const std::string& timeStr) {
        if (timeStr.empty() || timeStr.length() != 5) return -1;
        int hours = std::stoi(timeStr.substr(0, 2));
        int mins = std::stoi(timeStr.substr(3, 2));
        return hours * 60 + mins;
    }

    // Helper to format minutes since midnight back to "HH:MM"
    std::string formatTimeStr(int minutes) {
        int hours = minutes / 60;
        int mins = minutes % 60;
        char buf[6];
        snprintf(buf, sizeof(buf), "%02d:%02d", hours, mins);
        return std::string(buf);
    }
    
    // Convert "YYYY-MM-DD" to ISO day of week (1=Mon, 7=Sun)
    int getIsoDayOfWeek(const std::string& dateStr) {
        std::tm t = {};
        int y, m, d;
        if (sscanf(dateStr.c_str(), "%d-%d-%d", &y, &m, &d) != 3) return -1;
        t.tm_year = y - 1900;
        t.tm_mon = m - 1;
        t.tm_mday = d;
        t.tm_isdst = -1;
        std::mktime(&t);
        int wday = t.tm_wday; // 0=Sun, 1=Mon, ..., 6=Sat
        return (wday == 0) ? 7 : wday;
    }
}

std::vector<std::string> AppointmentService::generateAvailableSlots(
    const std::string& startTimeStr,
    const std::string& endTimeStr,
    const std::string& lunchStartStr,
    const std::string& lunchEndStr,
    int slotDurationMinutes,
    const std::vector<std::string>& bookedSlots,
    const std::string& targetDate,
    const std::string& nowUtc,
    const std::vector<int>& workingDays)
{
    std::vector<std::string> availableSlots;

    int dayOfWeek = getIsoDayOfWeek(targetDate);
    bool worksToday = false;
    for (int wd : workingDays) {
        if (wd == dayOfWeek) {
            worksToday = true;
            break;
        }
    }
    if (!workingDays.empty() && !worksToday) return availableSlots;

    int startMin = parseTimeStr(startTimeStr);
    int endMin = parseTimeStr(endTimeStr);
    int lunchStartMin = parseTimeStr(lunchStartStr);
    int lunchEndMin = parseTimeStr(lunchEndStr);

    if (startMin < 0 || endMin < 0 || slotDurationMinutes <= 0)
        return availableSlots;

    // Is it today? Compare "YYYY-MM-DD" prefixes
    bool isToday = false;
    int currentNowMin = -1;
    if (nowUtc.length() >= 10 && targetDate == nowUtc.substr(0, 10)) {
        isToday = true;
        if (nowUtc.length() >= 16) {
            // "YYYY-MM-DDTHH:MM:SSZ" -> "HH:MM"
            currentNowMin = parseTimeStr(nowUtc.substr(11, 5));
        }
    }

    int currentMin = startMin;
    while (currentMin + slotDurationMinutes <= endMin) {
        int slotEndMin = currentMin + slotDurationMinutes;

        bool overlapsLunch = false;
        if (lunchStartMin >= 0 && lunchEndMin >= 0) {
            if (currentMin < lunchEndMin && slotEndMin > lunchStartMin) {
                overlapsLunch = true;
            }
        }

        if (!overlapsLunch) {
            std::string slotStr = formatTimeStr(currentMin);
            
            bool isPast = false;
            if (isToday && currentMin <= currentNowMin) {
                isPast = true;
            }

            if (!isPast) {
                // Check if booked
                bool isBooked = false;
                for (const auto& bs : bookedSlots) {
                    if (bs == slotStr) {
                        isBooked = true;
                        break;
                    }
                }

                if (!isBooked) {
                    availableSlots.push_back(slotStr);
                }
            }
        }
        currentMin += slotDurationMinutes;
    }

    return availableSlots;
}

} // namespace ClinicQueue
