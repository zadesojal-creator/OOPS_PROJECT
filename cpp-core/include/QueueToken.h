#pragma once
#include "Enums.h"
#include <string>

namespace ClinicQueue {

/*
 * QueueToken — a token for a patient currently at the clinic.
 *
 * Encapsulation: fields are private, updated via methods.
 */
class QueueToken {
public:
    QueueToken(std::string id,
               std::string tokenNumber,
               std::string patientId,
               std::string patientName,
               Priority priority,
               TokenStatus status,
               std::string createdAt)
        : id_(std::move(id))
        , tokenNumber_(std::move(tokenNumber))
        , patientId_(std::move(patientId))
        , patientName_(std::move(patientName))
        , priority_(priority)
        , status_(status)
        , createdAt_(std::move(createdAt))
    {}

    const std::string& id()          const { return id_; }
    const std::string& tokenNumber() const { return tokenNumber_; }
    const std::string& patientId()   const { return patientId_; }
    const std::string& patientName() const { return patientName_; }
    Priority           priority()    const { return priority_; }
    TokenStatus        status()      const { return status_; }
    const std::string& createdAt()   const { return createdAt_; }
    const std::string& calledAt()    const { return calledAt_; }

    void setStatus(TokenStatus s) { status_ = s; }
    void setCalledAt(std::string t) { calledAt_ = std::move(t); }

private:
    std::string id_;
    std::string tokenNumber_;
    std::string patientId_;
    std::string patientName_;
    Priority    priority_;
    TokenStatus status_;
    std::string createdAt_;
    std::string calledAt_;
};

} // namespace ClinicQueue
