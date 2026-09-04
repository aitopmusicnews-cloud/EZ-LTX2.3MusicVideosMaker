from typing import Literal

from pydantic import BaseModel, Field, model_validator


ReferenceKind = Literal["character", "style", "location", "shot", "note"]


class ScriptLockedReference(BaseModel):
    id: str
    kind: ReferenceKind
    name: str
    description: str = ""


class ScriptLockedShot(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    visualDirection: str = ""
    cameraDirection: str = ""
    audioCue: str = ""
    onScreenText: str = ""
    selectedCharacterIds: list[str] = Field(default_factory=list)
    selectedReferenceIds: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_time_range(self):
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class CompileRequest(BaseModel):
    projectId: str
    visionMode: Literal["structured"]
    shots: list[ScriptLockedShot]
    references: list[ScriptLockedReference] = Field(default_factory=list)
    mustInclude: str = ""
    avoid: str = ""

    @model_validator(mode="after")
    def has_shots(self):
        if not self.shots:
            raise ValueError("at least one structured shot is required")
        return self


class AgnesExecutionShot(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    agnesPrompt: str
    selectedCharacterIds: list[str]
    selectedReferenceIds: list[str]
    continuityConstraints: list[str] = Field(default_factory=list)
    compilerNotes: list[str] = Field(default_factory=list)


class CompileResponse(BaseModel):
    compiler: Literal["videodb-scriptlocked-agnes-v1"] = "videodb-scriptlocked-agnes-v1"
    shots: list[AgnesExecutionShot]


class EditRequest(BaseModel):
    projectId: str
    target: Literal["agnes_instruction"]
    clipId: str
    start: float
    end: float
    sourceText: str
    currentAgnesPrompt: str
    selectedCharacterIds: list[str] = Field(default_factory=list)
    selectedReferenceIds: list[str] = Field(default_factory=list)
    continuityConstraints: list[str] = Field(default_factory=list)
    userMessage: str

    @model_validator(mode="after")
    def valid_edit_range(self):
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if not self.userMessage.strip():
            raise ValueError("userMessage is required")
        return self


class EditResponse(BaseModel):
    clipId: str
    start: float
    end: float
    sourceText: str
    agnesPrompt: str
    compilerNotes: list[str] = Field(default_factory=list)
