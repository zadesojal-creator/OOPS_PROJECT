#include <iostream>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include "QueueManager.h"
#include "AppointmentService.h"
#include "ValidationService.h"

using json = nlohmann::json;
using namespace ClinicQueue;

void processRequest(const json& req, json& res) {
    if (!req.contains("operation")) {
        res["ok"] = false;
        res["error"] = "Missing operation field";
        return;
    }

    std::string op = req["operation"];
    auto payload = req.value("payload", json::object());

    if (op == "generateSlots") {
        std::vector<std::string> bookedSlots;
        if (payload.contains("bookedSlots")) {
            for (const auto& s : payload["bookedSlots"]) {
                bookedSlots.push_back(s.get<std::string>());
            }
        }
        
        std::vector<int> workingDays;
        if (payload.contains("workingDays")) {
            for (const auto& wd : payload["workingDays"]) {
                workingDays.push_back(wd.get<int>());
            }
        }

        auto slots = AppointmentService::generateAvailableSlots(
            payload.value("startTime", "09:00"),
            payload.value("endTime", "17:00"),
            payload.value("lunchStart", "13:00"),
            payload.value("lunchEnd", "14:00"),
            payload.value("slotDurationMinutes", 20),
            bookedSlots,
            payload.value("targetDate", "2026-10-15"),
            payload.value("nowUtc", "2026-10-15T00:00:00Z"),
            workingDays
        );

        res["ok"] = true;
        res["slots"] = slots;
    }
    else if (op == "orderQueue") {
        std::vector<QueueToken> tokens;
        if (payload.contains("tokens")) {
            for (const auto& t : payload["tokens"]) {
                tokens.emplace_back(
                    t.value("id", ""),
                    t.value("tokenNumber", ""),
                    t.value("patientId", ""),
                    t.value("patientName", ""),
                    priorityFromString(t.value("priority", "NORMAL")),
                    TokenStatus::Waiting,
                    t.value("createdAt", "")
                );
            }
        }

        auto ordered = QueueManager::orderTokens(std::move(tokens));
        json outArray = json::array();
        for (const auto& t : ordered) {
            json item = {
                {"id", t.id()},
                {"tokenNumber", t.tokenNumber()},
                {"patientId", t.patientId()},
                {"patientName", t.patientName()},
                {"priority", priorityToString(t.priority())},
                {"createdAt", t.createdAt()}
            };
            outArray.push_back(item);
        }

        res["ok"] = true;
        res["ordered"] = outArray;
    }
    else if (op == "validateAppointment") {
        DoctorSchedule schedule;
        schedule.maxAppointments = payload.value("maxAppointments", 20);
        
        std::vector<DoctorHoliday> holidays;
        if (payload.contains("holidays")) {
            for (const auto& h : payload["holidays"]) {
                holidays.push_back({"", "", h.value("date", ""), h.value("reason", "")});
            }
        }

        std::vector<std::string> bookedSlots;
        if (payload.contains("bookedSlots")) {
            for (const auto& s : payload["bookedSlots"]) {
                bookedSlots.push_back(s.get<std::string>());
            }
        }

        auto result = ValidationService::validateAppointment(
            schedule, holidays, 
            payload.value("date", ""),
            payload.value("time", ""),
            bookedSlots
        );

        res["ok"] = result.ok;
        if (!result.ok) res["error"] = result.error;
    }
    else {
        res["ok"] = false;
        res["error"] = "Unknown operation: " + op;
    }
}

int main() {
    // Read JSON from stdin
    std::string inputStr;
    std::string line;
    while (std::getline(std::cin, line)) {
        inputStr += line + "\n";
    }

    if (inputStr.empty()) {
        std::cerr << "Error: No input provided on stdin\n";
        return 1;
    }

    json req;
    json res;
    try {
        req = json::parse(inputStr);
        processRequest(req, res);
    } catch (const std::exception& e) {
        res["ok"] = false;
        res["error"] = std::string("JSON parse error: ") + e.what();
    }

    // Write JSON to stdout
    std::cout << res.dump(4) << std::endl;
    return 0;
}
