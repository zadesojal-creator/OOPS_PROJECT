#pragma once
#include "Enums.h"
#include <string>

namespace ClinicQueue {

/*
 * Appointment — a scheduled patient-doctor visit.
 *
 * Encapsulation: all fields are private; access is through getters.
 * Status transitions are validated before being applied.
 *
 * Allowed transitions:
 *   BOOKED → CONFIRMED → CHECKED_IN → COMPLETED
 *   BOOKED / CONFIRMED / CHECKED_IN → CANCELLED
 *   BOOKED / CONFIRMED / CHECKED_IN → NO_SHOW
 */
class Appointment {
public:
    Appointment(std::string id,
                std::string patientId,
                std::string patientName,
                std::string doctorId,
                std::string doctorName,
                std::string date,       // "YYYY-MM-DD"
                std::string startTime,  // "HH:MM"
                AppointmentStatus status = AppointmentStatus::Booked,
                std::string source = "WEB",
                std::string createdAt = "")
        : id_(std::move(id))
        , patientId_(std::move(patientId))
        , patientName_(std::move(patientName))
        , doctorId_(std::move(doctorId))
        , doctorName_(std::move(doctorName))
        , date_(std::move(date))
        , startTime_(std::move(startTime))
        , status_(status)
        , source_(std::move(source))
        , createdAt_(std::move(createdAt))
    {}

    // Getters
    const std::string& id()          const { return id_; }
    const std::string& patientId()   const { return patientId_; }
    const std::string& patientName() const { return patientName_; }
    const std::string& doctorId()    const { return doctorId_; }
    const std::string& doctorName()  const { return doctorName_; }
    const std::string& date()        const { return date_; }
    const std::string& startTime()   const { return startTime_; }
    AppointmentStatus  status()      const { return status_; }
    const std::string& source()      const { return source_; }
    const std::string& createdAt()   const { return createdAt_; }
    const std::string& queueId()     const { return queueId_; }

    void setQueueId(std::string q) { queueId_ = std::move(q); }

    // Validates and applies a status transition.
    // Returns false if the transition is illegal.
    bool transitionTo(AppointmentStatus newStatus) {
        using AS = AppointmentStatus;
        switch (status_) {
            case AS::Booked:
                if (newStatus == AS::Confirmed || newStatus == AS::Cancelled || newStatus == AS::NoShow) {
                    status_ = newStatus; return true;
                }
                break;
            case AS::Confirmed:
                if (newStatus == AS::CheckedIn || newStatus == AS::Cancelled || newStatus == AS::NoShow) {
                    status_ = newStatus; return true;
                }
                break;
            case AS::CheckedIn:
                if (newStatus == AS::Completed || newStatus == AS::Cancelled || newStatus == AS::NoShow) {
                    status_ = newStatus; return true;
                }
                break;
            case AS::Completed:
            case AS::Cancelled:
            case AS::NoShow:
                break; // terminal states
        }
        return false;
    }

    bool isActive() const {
        return status_ == AppointmentStatus::Booked    ||
               status_ == AppointmentStatus::Confirmed ||
               status_ == AppointmentStatus::CheckedIn;
    }

private:
    std::string       id_;
    std::string       patientId_;
    std::string       patientName_;
    std::string       doctorId_;
    std::string       doctorName_;
    std::string       date_;
    std::string       startTime_;
    AppointmentStatus status_;
    std::string       source_;
    std::string       createdAt_;
    std::string       queueId_;
};

} // namespace ClinicQueue
