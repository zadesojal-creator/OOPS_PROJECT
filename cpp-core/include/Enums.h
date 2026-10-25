#pragma once
#include <string>
#include <stdexcept>

namespace ClinicQueue {

// ─── Role ─────────────────────────────────────────────────────────────────────
// Every person who logs into the system has one of these roles.
enum class Role {
    Patient,
    Doctor,
    Receptionist,
    Administrator
};

inline std::string roleToString(Role r) {
    switch (r) {
        case Role::Patient:       return "PATIENT";
        case Role::Doctor:        return "DOCTOR";
        case Role::Receptionist:  return "RECEPTIONIST";
        case Role::Administrator: return "ADMIN";
    }
    return "UNKNOWN";
}

inline Role roleFromString(const std::string& s) {
    if (s == "PATIENT")       return Role::Patient;
    if (s == "DOCTOR")        return Role::Doctor;
    if (s == "RECEPTIONIST")  return Role::Receptionist;
    if (s == "ADMIN")         return Role::Administrator;
    throw std::invalid_argument("Unknown role: " + s);
}

// ─── Priority ─────────────────────────────────────────────────────────────────
// Queue priority.  Lower numeric value = served first.
enum class Priority {
    Emergency = 0,   // life-threatening
    Senior    = 1,   // age >= 60
    Normal    = 2    // everyone else
};

inline int priorityRank(Priority p) { return static_cast<int>(p); }

inline std::string priorityToString(Priority p) {
    switch (p) {
        case Priority::Emergency: return "EMERGENCY";
        case Priority::Senior:    return "SENIOR";
        case Priority::Normal:    return "NORMAL";
    }
    return "NORMAL";
}

inline Priority priorityFromString(const std::string& s) {
    if (s == "EMERGENCY") return Priority::Emergency;
    if (s == "SENIOR")    return Priority::Senior;
    if (s == "NORMAL")    return Priority::Normal;
    throw std::invalid_argument("Unknown priority: " + s);
}

// ─── AppointmentStatus ────────────────────────────────────────────────────────
enum class AppointmentStatus {
    Booked,
    Confirmed,
    CheckedIn,
    Completed,
    Cancelled,
    NoShow
};

inline std::string appointmentStatusToString(AppointmentStatus s) {
    switch (s) {
        case AppointmentStatus::Booked:    return "BOOKED";
        case AppointmentStatus::Confirmed: return "CONFIRMED";
        case AppointmentStatus::CheckedIn: return "CHECKED_IN";
        case AppointmentStatus::Completed: return "COMPLETED";
        case AppointmentStatus::Cancelled: return "CANCELLED";
        case AppointmentStatus::NoShow:    return "NO_SHOW";
    }
    return "BOOKED";
}

inline AppointmentStatus appointmentStatusFromString(const std::string& s) {
    if (s == "BOOKED")     return AppointmentStatus::Booked;
    if (s == "CONFIRMED")  return AppointmentStatus::Confirmed;
    if (s == "CHECKED_IN") return AppointmentStatus::CheckedIn;
    if (s == "COMPLETED")  return AppointmentStatus::Completed;
    if (s == "CANCELLED")  return AppointmentStatus::Cancelled;
    if (s == "NO_SHOW")    return AppointmentStatus::NoShow;
    throw std::invalid_argument("Unknown appointment status: " + s);
}

// ─── TokenStatus ──────────────────────────────────────────────────────────────
enum class TokenStatus {
    Waiting,
    Called,
    Completed,
    Cancelled,
    Skipped
};

inline std::string tokenStatusToString(TokenStatus s) {
    switch (s) {
        case TokenStatus::Waiting:   return "WAITING";
        case TokenStatus::Called:    return "CALLED";
        case TokenStatus::Completed: return "COMPLETED";
        case TokenStatus::Cancelled: return "CANCELLED";
        case TokenStatus::Skipped:   return "SKIPPED";
    }
    return "WAITING";
}

inline TokenStatus tokenStatusFromString(const std::string& s) {
    if (s == "WAITING")   return TokenStatus::Waiting;
    if (s == "CALLED")    return TokenStatus::Called;
    if (s == "COMPLETED") return TokenStatus::Completed;
    if (s == "CANCELLED") return TokenStatus::Cancelled;
    if (s == "SKIPPED")   return TokenStatus::Skipped;
    throw std::invalid_argument("Unknown token status: " + s);
}

} // namespace ClinicQueue
