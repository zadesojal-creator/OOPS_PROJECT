#include "ValidationService.h"
#include <regex>

namespace ClinicQueue {

ValidationResult ValidationService::validatePatientProfile(
    const std::string& name,
    const std::string& phone,
    int age,
    const std::string& gender)
{
    if (name.length() < 2 || name.length() > 120) {
        return {false, "Name must be between 2 and 120 characters"};
    }
    
    static const std::regex phonePattern(R"(^\+?[0-9 .()\-]{7,20}$)");
    if (!std::regex_match(phone, phonePattern)) {
        return {false, "Invalid phone number format"};
    }

    if (age < 0 || age > 130) {
        return {false, "Age must be between 0 and 130"};
    }

    if (gender != "Female" && gender != "Male" && gender != "Other") {
        return {false, "Gender must be Female, Male, or Other"};
    }

    return {true, ""};
}

ValidationResult ValidationService::validateAppointment(
    const DoctorSchedule& schedule,
    const std::vector<DoctorHoliday>& holidays,
    const std::string& date,
    const std::string& time,
    const std::vector<std::string>& currentlyBookedSlots)
{
    // Check holidays
    for (const auto& h : holidays) {
        if (h.date == date) {
            return {false, "Doctor is on holiday on this date: " + h.reason};
        }
    }

    // Check capacity
    if (static_cast<int>(currentlyBookedSlots.size()) >= schedule.maxAppointments) {
        return {false, "Doctor has reached maximum appointments for this date"};
    }

    // Check if slot is already booked
    for (const auto& bs : currentlyBookedSlots) {
        if (bs == time) {
            return {false, "Slot is already booked"};
        }
    }

    return {true, ""};
}

} // namespace ClinicQueue
