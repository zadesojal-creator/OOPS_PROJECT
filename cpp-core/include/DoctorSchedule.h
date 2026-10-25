#pragma once
#include <string>
#include <vector>

namespace ClinicQueue {

/*
 * DoctorSchedule — Composition (HAS-A) inside Doctor.
 *
 * Stores the doctor's weekly working pattern.
 * This is what AppointmentService uses to generate available slots.
 *
 * workingDays: uses ISO 8601 day numbers (1 = Monday, 7 = Sunday).
 */
struct DoctorSchedule {
    std::string doctorId;
    std::string startTime;           // "09:00"
    std::string endTime;             // "17:00"
    std::string lunchStart;          // "13:00"
    std::string lunchEnd;            // "14:00"
    int         slotDurationMinutes; // 20
    int         maxAppointments;     // 20
    std::vector<int> workingDays;    // [1,2,3,4,5,6]  (Mon-Sat)

    // Default schedule used when no Firestore record exists for a doctor.
    static DoctorSchedule defaultSchedule(const std::string& doctorId) {
        return DoctorSchedule{
            doctorId, "09:00", "17:00", "13:00", "14:00",
            20, 20, {1, 2, 3, 4, 5, 6}
        };
    }

    // Returns true if the given ISO day-of-week (1-7) is a working day.
    bool worksOn(int dayOfWeek) const {
        for (int d : workingDays) {
            if (d == dayOfWeek) return true;
        }
        return false;
    }
};

/*
 * DoctorHoliday — a specific date when the doctor is unavailable.
 */
struct DoctorHoliday {
    std::string id;
    std::string doctorId;
    std::string date;   // "YYYY-MM-DD"
    std::string reason;
};

} // namespace ClinicQueue
