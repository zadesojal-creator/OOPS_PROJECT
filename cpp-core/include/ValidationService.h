#pragma once
#include "DoctorSchedule.h"
#include <string>
#include <vector>

namespace ClinicQueue {

struct ValidationResult {
    bool ok;
    std::string error;
};

/*
 * ValidationService
 * Encapsulates the scattered routing validation into testable C++ functions.
 */
class ValidationService {
public:
    static ValidationResult validatePatientProfile(const std::string& name,
                                                   const std::string& phone,
                                                   int age,
                                                   const std::string& gender);

    // Validates an appointment slot against doctor schedules and holidays
    static ValidationResult validateAppointment(const DoctorSchedule& schedule,
                                                const std::vector<DoctorHoliday>& holidays,
                                                const std::string& date,
                                                const std::string& time,
                                                const std::vector<std::string>& currentlyBookedSlots);
};

} // namespace ClinicQueue
